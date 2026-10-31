import Foundation
import XCTest
@testable import CompanionConversation

final class ImagePreviewTests: XCTestCase {
    func testDeviceCachePersistsBinaryImagesAndEvictsByLastAccessWithinItsSizeLimit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let host = String(repeating: "a", count: 64), other = String(repeating: "b", count: 64)
        let first = String(repeating: "1", count: 64), second = String(repeating: "2", count: 64)
        let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII="
        final class Clock: @unchecked Sendable { var value = Date(timeIntervalSince1970: 100) }
        let clock = Clock()
        func store() -> DeviceImageCache { DeviceImageCache(directory: root, maxBytes: 350, now: { clock.value }) }
        let cache = store()
        try await cache.write(host: host, key: first, dataUrl: image)
        clock.value.addTimeInterval(172_800)
        try await cache.write(host: other, key: first, dataUrl: image)
        clock.value.addTimeInterval(1)
        let retained = try await store().read(host: host, key: first)
        XCTAssertEqual(retained, image)
        clock.value.addTimeInterval(1)
        try await cache.write(host: host, key: second, dataUrl: image)
        let evicted = try await cache.read(host: other, key: first)
        XCTAssertNil(evicted)
        let recent = try await cache.read(host: host, key: first)
        XCTAssertEqual(recent, image)
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.fileSizeKey])
        XCTAssertLessThanOrEqual(try files.reduce(0) { try $0 + $1.resourceValues(forKeys: [.fileSizeKey]).fileSize! }, 350)
        let disk = try files.map { try Data(contentsOf: $0) }
        XCTAssertTrue(disk.allSatisfy { $0.range(of: Data(base64Encoded: String(image.split(separator: ",")[1]))!) != nil })
        XCTAssertFalse(disk.contains { $0.range(of: Data(image.utf8)) != nil })
        try await cache.forget(host: host)
        let forgotten = try await store().read(host: host, key: first)
        XCTAssertNil(forgotten)
        try await cache.write(host: other, key: first, dataUrl: image)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first)
        try Data("corrupt".utf8).write(to: file)
        let corrupt = try await cache.read(host: other, key: first)
        XCTAssertNil(corrupt)
        do { try await cache.write(host: "../escape", key: first, dataUrl: image); XCTFail("Invalid cache scope") } catch { }
        try await cache.write(host: host, key: first, dataUrl: "data:image/png;base64," + Data(repeating: 1, count: 400).base64EncodedString())
        let tooLarge = try await cache.read(host: host, key: first)
        XCTAssertNil(tooLarge)
    }
    func testDisplayedImageBytesAndCompleteWebDestinationsAreAccepted() throws {
        guard case .data(let bytes) = ImagePreview.Source("data:image/png;base64,aGVsbG8=") else { return XCTFail("Expected decoded image bytes") }
        XCTAssertEqual(bytes, Data("hello".utf8))
        let address = "https://example.com/image.png?signature=test#image"
        guard case .remote(let url) = ImagePreview.Source(address) else { return XCTFail("Expected web image") }
        XCTAssertEqual(url.absoluteString, address)
    }

    func testViewerCannotReadDeviceOrLaptopPathsOrExecutableSources() {
        for value in ["/Users/person/private.jpg", "file:///private/image.png", "companion://app/engine.html", "javascript:alert(1)", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,???", "data:image/png;base64,", "https:", "https://user:password@example.com/private.png", "blob:opaque"] {
            guard case .unavailable = ImagePreview.Source(value) else { XCTFail(value); continue }
        }
    }

    func testOversizedInlineImageIsRejectedBeforeDecoding() {
        let oversized = "data:image/png;base64," + String(repeating: "A", count: 26_666_672)
        guard case .unavailable = ImagePreview.Source(oversized) else { return XCTFail("Expected bounded image payload") }
    }
}
