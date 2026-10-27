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

    private let working = #"{"id":"m","outcome":"Ship it","stage":"implementation","status":"active","done":2,"leadAgentId":"lead","next":"review","startedAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T03:00:00Z","tickets":[{"number":1,"title":"A","state":"accepted"},{"number":2,"title":"B","state":"accepted"},{"number":3,"title":"Open workers","state":"running","agentId":"w","activity":"editing client.ts"},{"number":4,"title":"D","state":"awaitingReview","agentId":"x","runId":"run-4"},{"number":5,"title":"E","state":"failed"},{"number":6,"title":"F","state":"blocked","after":[3,4]}]}"#

    func testCountsWhatNeedsAPersonAndWhatIsMoving() throws {
        let mission = try mission(working)
        XCTAssertEqual(mission.attentionCount, 2)
        XCTAssertEqual(mission.workingCount, 1)
        XCTAssertEqual(mission.nowLine, "03 Open workers")
        XCTAssertEqual(mission.tickets[2].activity, "editing client.ts")
        XCTAssertEqual(mission.tickets[5].after, [3, 4])
        XCTAssertEqual(mission.stageIndex, 2)
        XCTAssertEqual(mission.leadAgentId, "lead")
        XCTAssertEqual(mission.tickets[3].runId, "run-4")
        XCTAssertTrue(mission.canContinueToReview)
        XCTAssertFalse(mission.shipsOnDesktop)
        XCTAssertFalse(mission.allTicketsDone)
        XCTAssertFalse(mission.isReadyToShip)
    }

    func testIsReadyToShipOnlyOnceTheMissionReachesItsShipStage() throws {
        let tickets = #""done":2,"tickets":[{"number":1,"title":"A","state":"accepted"},{"number":2,"title":"B","state":"accepted"}]"#
        func mission(stage: String, status: String = "active") throws -> MissionSummary {
            try self.mission(#"{"id":"m","outcome":"o","stage":"\#(stage)","status":"\#(status)",\#(tickets)}"#)
        }
        // Every ticket done is not enough: the review still has to happen.
        XCTAssertFalse(try mission(stage: "implementation").isReadyToShip)
        XCTAssertFalse(try mission(stage: "review").isReadyToShip)
        XCTAssertTrue(try mission(stage: "ship").isReadyToShip)
        XCTAssertFalse(try mission(stage: "ship", status: "completed").isReadyToShip)
    }

    func testElapsedRunsToNowWhileActiveAndStopsAtTheLastChangeOnceOver() throws {
        let now = ISO8601DateFormatter().date(from: "2026-01-01T02:14:00Z")!
        XCTAssertEqual(try mission(working).elapsed(now: now), 2 * 3600 + 14 * 60)
        let over = working.replacingOccurrences(of: "\"active\"", with: "\"completed\"")
        XCTAssertEqual(try mission(over).elapsed(now: now), 3 * 3600)
        XCTAssertNil(try mission(#"{"id":"m","outcome":"o","stage":"ship","status":"active","done":0,"tickets":[]}"#).elapsed(now: now))
        XCTAssertEqual(MissionSummary.elapsedText(2 * 3600 + 14 * 60), "2h 14m")
        XCTAssertEqual(MissionSummary.elapsedText(14 * 60 + 5), "14m")
        XCTAssertEqual(MissionSummary.elapsedText(20), "Under a minute")
        XCTAssertEqual(MissionSummary.elapsedText(26 * 3600), "1d 2h")
    }

    func testCompletePerTicketsAndTheShipStepAreSeparateFromTheStage() throws {
        let all = #"{"id":"m","outcome":"o","stage":"review","status":"active","done":2,"next":"ship","tickets":[{"number":1,"title":"A","state":"accepted"},{"number":2,"title":"B","state":"accepted"}]}"#
        let mission = try mission(all)
        XCTAssertTrue(mission.allTicketsDone)
        XCTAssertFalse(mission.isReadyToShip)
        XCTAssertTrue(mission.shipsOnDesktop)
        XCTAssertFalse(mission.canContinueToReview)
        XCTAssertFalse(try self.mission(#"{"id":"m","outcome":"o","stage":"requirements","status":"active","done":0,"tickets":[]}"#).allTicketsDone)
    }

    func testReadsAReviewAndSaysWhereAndWhatIsLeftToDo() throws {
        let json = #"{"id":"m","outcome":"o","stage":"review","status":"active","done":1,"tickets":[],"review":{"summary":"Three issues","ready":true,"findings":[{"id":"a","priority":"p1","title":"A","body":"b","repository":"korus","file":"auth/session.ts","line":142,"endLine":150,"selected":true,"state":"open"},{"id":"b","priority":"p3","title":"B","body":"b","repository":"korus","file":"x.ts","line":7,"selected":false,"state":"fixed"},{"id":"c","priority":"p1","title":"C","body":"b","repository":"korus","selected":true,"state":"fixing"},{"id":"d","priority":"p2","title":"D","body":"b","repository":"korus","selected":false,"state":"skipped"}]}}"#
        let review = try XCTUnwrap(try mission(json).review)
        XCTAssertEqual(review.findings[0].location, "auth/session.ts · lines 142–150")
        XCTAssertEqual(review.findings[1].location, "x.ts · line 7")
        XCTAssertNil(review.findings[2].location)
        XCTAssertEqual(review.fixedCount, 1)
        XCTAssertEqual(review.selectedCount, 1, "A finding already being fixed is not selectable")
        XCTAssertEqual(review.fixingCount, 1)
        XCTAssertFalse(review.canRerun)
        XCTAssertEqual(review.groups.map(\.priority), ["P1", "P2", "P3"])
        XCTAssertEqual(review.groups[0].findings.map(\.id), ["a", "c"])
        XCTAssertEqual(review.progress, 0.25)
        let settled = json.replacingOccurrences(of: "\"state\":\"open\"", with: "\"state\":\"fixed\"").replacingOccurrences(of: "\"state\":\"fixing\"", with: "\"state\":\"skipped\"")
        XCTAssertTrue(try XCTUnwrap(try mission(settled).review).canRerun)
    }
    // Partial findings must not allow a premature fix; remediation must survive a reload and stay visible after completion.
    func testReviewWaitsForSubmissionAndShowsOnlyRemediationFindingsThroughCompletion() throws {
        let json = #"{"id":"m","outcome":"o","stage":"review","status":"active","done":1,"tickets":[],"review":{"summary":"Two issues","ready":false,"findings":[{"id":"a","priority":"p1","title":"A","body":"b","repository":"korus","selected":true,"state":"open"},{"id":"b","priority":"p2","title":"B","body":"b","repository":"korus","selected":false,"state":"open"}]}}"#
        let initial = try mission(json)
        XCTAssertFalse(try XCTUnwrap(initial.review).canFix)
        XCTAssertFalse(try XCTUnwrap(initial.review).canFinish)
        XCTAssertNil(initial.remediationReview)
        let oldDaemon = json.replacingOccurrences(of: #""ready":false,"#, with: "")
        XCTAssertFalse(try XCTUnwrap(try mission(oldDaemon).review).canFix)
        let submitted = json.replacingOccurrences(of: #""ready":false"#, with: #""ready":true"#)
        XCTAssertTrue(try XCTUnwrap(try mission(submitted).review).canFix)
        XCTAssertFalse(try XCTUnwrap(try mission(submitted).review).canFinish)
        let fixing = submitted.replacingOccurrences(of: #""state":"open""#, with: #""state":"fixing""#, range: submitted.range(of: #""state":"open""#))
            .replacingOccurrences(of: #""state":"open""#, with: #""state":"skipped""#)
        let active = try XCTUnwrap(try mission(fixing).remediationReview)
        XCTAssertEqual(active.findings.map(\.id), ["a"])
        XCTAssertEqual(active.fixingCount, 1)
        XCTAssertFalse(active.canFix)
        XCTAssertFalse(active.canFinish)
        let completed = fixing.replacingOccurrences(of: #""state":"fixing""#, with: #""state":"fixed""#)
        let done = try XCTUnwrap(try mission(completed).remediationReview)
        XCTAssertEqual(done.findings.map(\.id), ["a"])
        XCTAssertEqual(done.fixedCount, 1)
        XCTAssertEqual(done.progress, 1)
        XCTAssertTrue(done.canRerun)
        XCTAssertTrue(done.canFinish)
    }

}
