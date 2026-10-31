import Foundation
import CryptoKit

/// Disposable encoded image bytes in the OS cache directory; never a transcript or image archive.
actor DeviceImageCache {
    static let shared = DeviceImageCache(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("ConversationImages/v1"))
    private let directory: URL
    private let maxBytes: Int
    private let now: @Sendable () -> Date
    private let files = FileManager.default
    private static let formats = Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic", "image/heif", "image/avif", "image/bmp"])
    private enum Failure: Error { case invalid }

    init(directory: URL, maxBytes: Int = 256 * 1024 * 1024, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory; self.maxBytes = maxBytes; self.now = now
    }
    private func valid(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private func file(host: String, key: String) throws -> URL {
        guard valid(host), valid(key) else { throw Failure.invalid }
        return directory.appendingPathComponent("\(host)-\(key).image")
    }
    private func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }

    func read(host: String, key: String) throws -> String? {
        let url = try file(host: host, key: key)
        guard files.fileExists(atPath: url.path) else { return nil }
        let attributes = try files.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.intValue <= ImagePreview.Source.maxBytes + 128 else {
            try? files.removeItem(at: url); return nil
        }
        let record = try Data(contentsOf: url, options: .mappedIfSafe)
        guard let first = record.firstIndex(of: 10), first < 32,
              let second = record[(first + 1)...].firstIndex(of: 10), second == first + 65,
              let mime = String(data: record[..<first], encoding: .ascii), Self.formats.contains(mime),
              let fingerprint = String(data: record[(first + 1)..<second], encoding: .ascii),
              record.count > second + 1 else { try? files.removeItem(at: url); return nil }
        let bytes = record[(second + 1)...]
        guard bytes.count <= ImagePreview.Source.maxBytes, hash(bytes) == fingerprint else { try? files.removeItem(at: url); return nil }
        try files.setAttributes([.modificationDate: now()], ofItemAtPath: url.path)
        return "data:\(mime);base64,\(bytes.base64EncodedString())"
    }

    func write(host: String, key: String, dataUrl: String) throws {
        let url = try file(host: host, key: key)
        guard case .data(let bytes) = ImagePreview.Source(dataUrl), let comma = dataUrl.firstIndex(of: ",") else { throw Failure.invalid }
        let mime = String(dataUrl[..<comma].dropFirst(5).dropLast(7)).lowercased()
        let header = Data("\(mime)\n\(hash(bytes))\n".utf8)
        let size = header.count + bytes.count
        guard size <= maxBytes else { return }
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        if files.fileExists(atPath: url.path) { try files.removeItem(at: url) }
        let records = try entries()
        var retained = records.reduce(0) { $0 + $1.size }
        for record in records.sorted(by: { $0.date < $1.date }) where retained + size > maxBytes {
            try files.removeItem(at: record.url); retained -= record.size
        }
        let temporary = directory.appendingPathComponent(".pending-\(UUID().uuidString)")
        defer { try? files.removeItem(at: temporary) }
        guard files.createFile(atPath: temporary.path, contents: nil) else { throw Failure.invalid }
        let output = try FileHandle(forWritingTo: temporary)
        do { try output.write(contentsOf: header); try output.write(contentsOf: bytes); try output.close() }
        catch { try? output.close(); throw error }
        try files.moveItem(at: temporary, to: url)
        try files.setAttributes([.modificationDate: now()], ofItemAtPath: url.path)
    }

    func forget(host: String) throws {
        guard valid(host) else { throw Failure.invalid }
        for record in try entries() where record.url.lastPathComponent.hasPrefix(host + "-") { try files.removeItem(at: record.url) }
    }
    private func entries() throws -> [(url: URL, size: Int, date: Date)] {
        guard files.fileExists(atPath: directory.path) else { return [] }
        return try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).compactMap { url in
            let attributes = try files.attributesOfItem(atPath: url.path)
            guard url.pathExtension == "image", attributes[.type] as? FileAttributeType == .typeRegular else {
                try files.removeItem(at: url); return nil
            }
            return (url, (attributes[.size] as? NSNumber)?.intValue ?? 0, attributes[.modificationDate] as? Date ?? .distantPast)
        }
    }
}
