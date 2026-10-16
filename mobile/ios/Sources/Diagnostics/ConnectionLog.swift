import Foundation

/// Local, bounded metadata for diagnosing connection failures. Never contains transcript payloads.
final class ConnectionLog: Sendable {
    private let directory: URL
    private let maxBytes: Int
    private let manager = FileManager.default
    private let lock = NSLock()
    init(directory: URL, maxBytes: Int = 512 * 1024) {
        self.directory = directory
        self.maxBytes = maxBytes
    }

    func append(_ record: [String: Any]) {
        // Keep this boundary narrow even if a future engine caller passes extra fields.
        let keys: Set<String> = ["event", "at", "streamId", "requestId", "method", "reason", "stage",
                                 "elapsedMs", "idleMs", "pending", "sequence", "oldestMethod", "oldestAgeMs",
                                 "agentId", "errorName", "errorCode", "reused", "connectionCount",
                                 "connectionId", "remainingBytes", "remainingSeconds", "closeCode", "wasClean"]
        let safe = record.filter { keys.contains($0.key) && ($0.value is String || $0.value is NSNumber) }
        guard var line = try? JSONSerialization.data(withJSONObject: safe, options: [.sortedKeys]), line.count < min(4096, maxBytes) else { return }
        line.append(0x0a)
        lock.lock()
        defer { lock.unlock() }
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            let current = directory.appendingPathComponent("connection.jsonl")
            let previous = directory.appendingPathComponent("connection.previous.jsonl")
            let size = (try? manager.attributesOfItem(atPath: current.path)[.size] as? NSNumber)?.intValue ?? 0
            if size + line.count > maxBytes && manager.fileExists(atPath: current.path) {
                if manager.fileExists(atPath: previous.path) { try manager.removeItem(at: previous) }
                try manager.moveItem(at: current, to: previous)
            }
            if !manager.fileExists(atPath: current.path) { manager.createFile(atPath: current.path, contents: nil) }
            let handle = try FileHandle(forWritingTo: current)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
        } catch { /* Logging cannot interrupt the engine or cryptography bridge. */ }
    }
}
