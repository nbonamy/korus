import XCTest
@testable import CompanionSidebar

// Native-only failure modes: a cross-section move changes row identity; a view choice leaks
// across teams/laptops, resets on relaunch, or defaults to the wrong organization.
final class ActivitySidebarTests: XCTestCase {
    func testAgentIdentitySurvivesCrossSectionMovesAndEmptyHeadersDisappear() {
        let session = SidebarSession(agentId: "a", title: "Mobile", kind: .worktree, status: .working)
        let before = SidebarActivityItem.project([
            SidebarGroup(id: "activity:working", kind: .folder, label: "Working", sessions: [session], activity: .working)
        ])
        var finished = session
        finished = SidebarSession(agentId: finished.agentId, title: finished.title, kind: finished.kind, status: .idle)
        let after = SidebarActivityItem.project([
            SidebarGroup(id: "activity:recent", kind: .folder, label: "Done", sessions: [finished], activity: .recent)
        ])
        XCTAssertEqual(before.map(\.id), ["header:activity:working", "agent:a"])
        XCTAssertEqual(after.map(\.id), ["header:activity:recent", "agent:a"])
        XCTAssertEqual(before.last?.id, after.last?.id)
    }

    func testOrganizationChoicePersistsOnlyForItsLaptopAndTeam() {
        let name = "activity-sidebar-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let preferences = SidebarPreferences(defaults: defaults)
        XCTAssertEqual(preferences.organization(hostId: "laptop", teamId: "one"), .activity)
        preferences.setOrganization(.repository, hostId: "laptop", teamId: "one")
        XCTAssertEqual(SidebarPreferences(defaults: defaults).organization(hostId: "laptop", teamId: "one"), .repository)
        XCTAssertEqual(preferences.organization(hostId: "laptop", teamId: "two"), .activity)
        XCTAssertEqual(preferences.organization(hostId: "other", teamId: "one"), .activity)
    }
}
