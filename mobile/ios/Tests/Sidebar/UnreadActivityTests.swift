import XCTest
@testable import CompanionSidebar

final class UnreadActivityTests: XCTestCase {
    func testMenuIndicatorIncludesOtherTeamsAndClearsWhenAllThreadsAreRead() {
        var teams = [Team(id: "current", name: "Current", isUnread: false), Team(id: "other", name: "Other", isUnread: true)]
        XCTAssertTrue(teams.hasUnreadActivity)
        teams[1].isUnread = false
        XCTAssertFalse(teams.hasUnreadActivity)
        teams[0].isUnread = true
        XCTAssertTrue(teams.hasUnreadActivity)
        teams[0].isUnread = nil
        XCTAssertFalse(teams.hasUnreadActivity)
        XCTAssertFalse([Team]().hasUnreadActivity)
    }
}
