import XCTest
@testable import CompanionDiagnostics

final class ConnectionLogTests: XCTestCase {
    func testRetainsRecentMetadataAcrossReopenWithoutPayloadsOrUnboundedGrowth() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = ConnectionLog(directory: directory, maxBytes: 160)
        for index in 0..<20 {
            log.append(["event": "rpc.request", "requestId": "\(index)", "args": ["text": "private message"], "token": "secret"])
        }
        let reopened = ConnectionLog(directory: directory, maxBytes: 160)
        reopened.append(["event": "updates.disconnect", "reason": "request-timeout"])
        reopened.append(["event": "transport.socket-close", "closeCode": 1001, "wasClean": true, "payload": "private data"])
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        XCTAssertEqual(Set(files.map(\.lastPathComponent)), ["connection.jsonl", "connection.previous.jsonl"])
        var records: [[String: Any]] = []
        for file in files {
            let data = try Data(contentsOf: file)
            XCTAssertLessThanOrEqual(data.count, 160)
            for line in data.split(separator: 0x0a) {
                records.append(try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line)) as? [String: Any]))
            }
        }
        XCTAssertTrue(records.contains { $0["event"] as? String == "updates.disconnect" })
        let closure = try XCTUnwrap(records.first { $0["event"] as? String == "transport.socket-close" })
        XCTAssertEqual(closure["closeCode"] as? Int, 1001)
        XCTAssertEqual(closure["wasClean"] as? Bool, true)
        XCTAssertTrue(records.allSatisfy { $0["args"] == nil && $0["token"] == nil && $0["payload"] == nil })
        XCTAssertLessThan(records.count, 20)
    }
}
