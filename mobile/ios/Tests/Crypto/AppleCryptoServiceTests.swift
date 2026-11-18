import XCTest
@testable import CompanionCrypto

/// The engine page can die without closing its encrypted connections. A new page must still connect, and work the dead
/// page left queued must never touch the connections of the page that replaced it.
private final class Outcome: @unchecked Sendable { var value: Result<[String: Any], Error>? }

final class AppleCryptoServiceTests: XCTestCase {
    private var script: URL!

    override func setUpWithError() throws {
        // The app ships the bundled Noise session built by `npm run build:web -w @workspace/mobile`.
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Web/noise-session.js").standardized
        try XCTSkipUnless(FileManager.default.fileExists(atPath: url.path), "Build the mobile web assets first: noise-session.js is missing.")
        script = url
    }

    private func call(_ service: AppleCryptoService, _ command: [String: Any], generation: Int? = nil) throws -> [String: Any] {
        let done = expectation(description: "crypto")
        let outcome = Outcome()
        let completion: @Sendable (Result<[String: Any], Error>) -> Void = { result in outcome.value = result; done.fulfill() }
        if let generation { service.execute(command, generation: generation, completion: completion) } else { service.execute(command, completion: completion) }
        wait(for: [done], timeout: 10)
        return try outcome.value!.get()
    }

    private func session(_ service: AppleCryptoService, initiator: Bool) throws -> String {
        guard let id = try call(service, ["op": "create", "initiator": initiator])["id"] as? String else { throw AppleCryptoService.Failure.staleEngine }
        return id
    }

    /// A full XX handshake and one record each way, between two sessions of the same native registry.
    private func connect(_ service: AppleCryptoService) throws {
        let noise = { (command: [String: Any]) throws -> [String: Any] in try self.call(service, command) }
        let a = try session(service, initiator: true), b = try session(service, initiator: false)
        let m1 = try XCTUnwrap(noise(["op": "writeA", "id": a])["data"] as? String)
        _ = try noise(["op": "readA", "id": b, "data": m1])
        let m2 = try XCTUnwrap(noise(["op": "writeB", "id": b, "data": ""])["data"] as? String)
        _ = try noise(["op": "readB", "id": a, "data": m2])
        let m3 = try XCTUnwrap(noise(["op": "writeC", "id": a, "data": ""])["data"] as? String)
        _ = try noise(["op": "readC", "id": b, "data": m3])
        _ = try noise(["op": "split", "id": a]); _ = try noise(["op": "split", "id": b])
        let plain = Data("hello".utf8).base64EncodedString()
        let sealed = try XCTUnwrap((noise(["op": "encrypt", "id": a, "records": [plain]])["records"] as? [String])?.first)
        let opened = try XCTUnwrap((noise(["op": "decrypt", "id": b, "records": [sealed]])["records"] as? [String])?.first)
        XCTAssertEqual(opened, plain)
    }

    func testEnginesThatDieWithOpenConnectionsNeverExhaustTheNativeRegistry() throws {
        let service = AppleCryptoService(scriptURL: script)
        for _ in 0..<4 {
            // A page that dies with every slot taken: it never gets to close them.
            for _ in 0..<8 { _ = try session(service, initiator: true) }
            XCTAssertThrowsError(try session(service, initiator: true))
            service.reset()
        }
        try connect(service)
    }

    func testWorkLeftByADeadEngineFailsWithoutTouchingTheReplacementConnections() throws {
        let service = AppleCryptoService(scriptURL: script)
        let dead = service.generation
        let old = try session(service, initiator: true)
        service.reset()
        let replacement = try session(service, initiator: true)
        XCTAssertEqual(old, replacement, "Session ids restart with a new registry, which is why stale work must be refused.")
        XCTAssertThrowsError(try call(service, ["op": "close", "id": old], generation: dead))
        XCTAssertThrowsError(try call(service, ["op": "writeA", "id": old], generation: dead))
        XCTAssertNotNil(try call(service, ["op": "writeA", "id": replacement])["data"])
    }
}
