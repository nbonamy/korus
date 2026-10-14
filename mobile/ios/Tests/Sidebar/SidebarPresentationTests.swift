import XCTest
@testable import CompanionSidebar

final class SidebarPresentationTests: XCTestCase {
    func testQuickChatActionMovesToHeaderOnlyWhenQuickChatsExist() {
        let session = SidebarSession(agentId: "chat", title: "A chat", kind: .folder, status: .idle)
        var group = SidebarGroup(id: "chats", kind: .quickChats, label: "Chats", sessions: [])
        XCTAssertFalse(group.hasQuickChats)
        group.sessions = [session]
        XCTAssertTrue(group.hasQuickChats)
        XCTAssertFalse(SidebarGroup(id: "repo", kind: .repository, label: "Repo", sessions: [session]).hasQuickChats)
    }

    func testLettersAndFallbackIconsHaveBadgesButPictographsAndImagesDoNot() {
        for icon in [nil, "", "K", "é", "7"] as [String?] {
            XCTAssertTrue(SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: icon, sessions: []).usesIconBadge)
        }
        for icon in ["🦞", "⚙️", "⚙", "data:image/png;base64,fixture"] {
            XCTAssertFalse(SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: icon, sessions: []).usesIconBadge)
        }
        XCTAssertFalse(SidebarGroup(id: "chats", kind: .quickChats, label: "Chats", sessions: []).usesIconBadge)
    }
}
