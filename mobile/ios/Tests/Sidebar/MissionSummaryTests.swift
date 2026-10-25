import XCTest
@testable import CompanionSidebar

final class MissionSummaryTests: XCTestCase {
    private func mission(_ json: String) throws -> MissionSummary {
        try JSONDecoder().decode(MissionSummary.self, from: Data(json.utf8))
    }

    func testSummarizesTicketProgressUnderTheStage() throws {
        let running = try mission(#"{"id":"m","outcome":"Ship it","stage":"implementation","status":"active","done":3,"tickets":[{"number":1,"title":"A","state":"accepted"},{"number":2,"title":"B","state":"running","agentId":"w"},{"number":3,"title":"C","state":"blocked"},{"number":4,"title":"D","state":"queued"},{"number":5,"title":"E","state":"queued"},{"number":6,"title":"F","state":"queued"},{"number":7,"title":"G","state":"queued"}]}"#)
        XCTAssertEqual(running.summary, "Implementation · 3 of 7 tickets")
        XCTAssertTrue(running.isActive)
        XCTAssertEqual(running.progress, 3.0 / 7.0, accuracy: 0.0001)
        XCTAssertEqual(running.tickets[1].agentId, "w")
        let shaping = try mission(#"{"id":"n","outcome":"Plan","stage":"requirements","status":"active","done":0,"tickets":[]}"#)
        XCTAssertEqual(shaping.summary, "Requirements")
        XCTAssertEqual(shaping.progress, 0)
    }

    func testReadsEveryTicketStateTheEngineSendsAndToleratesANewOne() {
        let states = ["blocked", "queued", "preparing", "running", "awaitingReview", "accepted", "cancelled", "failed"]
        XCTAssertEqual(states.map { MissionTicketState($0).rawValue }, states)
        XCTAssertEqual(MissionTicketState("somethingNew"), .queued)
        XCTAssertEqual(MissionTicketState.awaitingReview.label, "Ready for review")
    }
}
