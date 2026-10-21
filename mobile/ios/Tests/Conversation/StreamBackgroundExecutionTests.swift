import XCTest
@testable import CompanionConversation

final class StreamBackgroundExecutionTests: XCTestCase {
    @MainActor func testActiveStreamHoldsOneLeaseAcrossShortAppSwitchAndEndsOnCompletion() async {
        var expirations: [@MainActor () -> Void] = []
        var ended: [Int] = []
        let execution = StreamBackgroundExecution(begin: { expiry in expirations.append(expiry); return expirations.count }, end: { ended.append($0) })
        execution.update(working: false, foreground: true)
        XCTAssertTrue(expirations.isEmpty)
        execution.update(working: true, foreground: true)
        execution.update(working: true, foreground: false)
        execution.update(working: true, foreground: false)
        execution.update(working: true, foreground: true)
        XCTAssertEqual(expirations.count, 1)
        XCTAssertTrue(ended.isEmpty)
        execution.update(working: false, foreground: true)
        execution.update(working: false, foreground: false)
        XCTAssertEqual(ended, [1])
    }

    @MainActor func testExpiryDoesNotRenewInBackgroundOrLetAnOldCallbackEndNewWork() async {
        var expirations: [@MainActor () -> Void] = []
        var ended: [Int] = []
        let execution = StreamBackgroundExecution(begin: { expiry in expirations.append(expiry); return expirations.count }, end: { ended.append($0) })
        execution.update(working: true, foreground: true)
        execution.update(working: true, foreground: false)
        expirations[0]()
        execution.update(working: true, foreground: false)
        XCTAssertEqual(expirations.count, 1)
        XCTAssertEqual(ended, [1])
        execution.update(working: true, foreground: true)
        XCTAssertEqual(expirations.count, 2)
        expirations[0]()
        XCTAssertEqual(ended, [1])
        execution.update(working: false, foreground: true)
        XCTAssertEqual(ended, [1, 2])
    }

    @MainActor func testRefusedLeaseIsNotRetriedOnEveryStreamingUpdate() async {
        var attempts = 0
        let execution = StreamBackgroundExecution(begin: { _ in attempts += 1; return nil }, end: { _ in XCTFail("No lease was granted") })
        execution.update(working: true, foreground: true)
        execution.update(working: true, foreground: true)
        execution.update(working: true, foreground: false)
        XCTAssertEqual(attempts, 1)
        execution.update(working: true, foreground: true)
        XCTAssertEqual(attempts, 2)
        execution.update(working: false, foreground: true)
    }
}
