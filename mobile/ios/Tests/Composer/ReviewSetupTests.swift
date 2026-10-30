import Foundation
import XCTest
@testable import CompanionComposer

final class ReviewSetupTests: XCTestCase {
    private func setup(current: Bool = false, tiers: [ReviewSetup.Model.Tier]? = nil) -> ReviewSetup {
        .init(target: .init(hostId: "host", locationId: "local", teamId: "team", agentId: "agent", sessionId: nil),
              branch: "feature", baseRef: "main", uncommitted: false, branchChanges: true, currentThread: current, activeReview: false,
              agentBackend: "codex", backend: "claude", backends: ["codex", "claude"], models: [.init(id: "review", name: "Review", efforts: ["high"], tiers: tiers)],
              preferences: .init(providers: ["claude": .init(model: "review", reasoningEffort: "high")]))
    }

    func testReviewChoicesEncodeDesktopInputAndRequireOptInForAutomationAndCommits() throws {
        let setup = setup()
        var choices = ReviewChoices(); choices.load(setup, initial: true)
        choices.instructions = "  Check retries  "
        let input = try XCTUnwrap(choices.input(setup))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? NSDictionary)
        XCTAssertEqual(json, ["scope": ["type": "branch", "baseRef": "main"], "threadMode": "independent", "selection": ["backend": "claude", "model": "review", "reasoningEffort": "high", "serviceTier": NSNull()], "instructions": "Check retries",
                              "automation": ["enabled": false, "maxPriority": "p2", "maxRounds": 3, "autoCommit": false]] as NSDictionary)
        choices.autoCommit = true
        XCTAssertFalse(try XCTUnwrap(choices.input(setup)).automation.autoCommit)
        choices.automatic = true
        XCTAssertTrue(try XCTUnwrap(choices.input(setup)).automation.autoCommit)
        choices.serviceTier = "fast"
        XCTAssertEqual(try XCTUnwrap(choices.input(self.setup(tiers: [.init(id: "fast", name: "Fast")]))).selection?.serviceTier, "fast")
        XCTAssertNil(try XCTUnwrap(choices.input(self.setup(tiers: []))).selection?.serviceTier)
        choices.model = ""
        XCTAssertNil(try XCTUnwrap(choices.input(setup)).selection?.serviceTier)
        choices.scope = "uncommitted"
        XCTAssertNil(choices.input(setup))
    }

    func testCurrentConversationUsesItsOwnModelAndCannotRunAutomaticReview() throws {
        var choices = ReviewChoices(); choices.load(setup(), initial: true); choices.thread = "current"
        XCTAssertNil(choices.input(setup()))
        let input = try XCTUnwrap(choices.input(setup(current: true)))
        XCTAssertNil(input.selection)
        choices.automatic = true
        XCTAssertNil(choices.input(setup(current: true)))
    }
}
