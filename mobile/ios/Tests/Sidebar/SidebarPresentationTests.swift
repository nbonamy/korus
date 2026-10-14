import XCTest
@testable import CompanionSidebar

final class SidebarPresentationTests: XCTestCase {
    func testRepositoryImageIconsSupplyImageBytesInsteadOfDataURLText() {
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCYsAAAAASUVORK5CYII=")!
        let group = SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: "data:image/png;base64," + png.base64EncodedString(), sessions: [])
        XCTAssertEqual(group.imageIconData, png)
        for icon in ["K", "🦞", "data:image/png;base64,!", "data:text/plain;base64,aGk="] {
            XCTAssertNil(SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: icon, sessions: []).imageIconData)
        }
    }
    func testQuickChatActionMovesToHeaderOnlyWhenQuickChatsExist() {
        let session = SidebarSession(agentId: "chat", title: "A chat", kind: .folder, status: .idle)
        var group = SidebarGroup(id: "chats", kind: .quickChats, label: "Chats", sessions: [])
        XCTAssertFalse(group.hasQuickChats)
        group.sessions = [session]
        XCTAssertTrue(group.hasQuickChats)
        XCTAssertFalse(SidebarGroup(id: "repo", kind: .repository, label: "Repo", sessions: [session]).hasQuickChats)
    }

    func testOnlyCustomLetterIconsHaveBadges() {
        for icon in ["K", "é", "7"] {
            XCTAssertTrue(SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: icon, sessions: []).usesIconBadge)
        }
        for icon in ["🦞", "⚙️", "⚙", "data:image/png;base64,fixture"] {
            XCTAssertFalse(SidebarGroup(id: "repo", kind: .repository, label: "Repo", icon: icon, sessions: []).usesIconBadge)
        }
        XCTAssertFalse(SidebarGroup(id: "chats", kind: .quickChats, label: "Chats", sessions: []).usesIconBadge)
        for kind in [GroupKind.repository, .folder] {
            for icon in [nil, ""] as [String?] {
                XCTAssertFalse(SidebarGroup(id: "group", kind: kind, label: "Folder", icon: icon, sessions: []).usesIconBadge)
            }
        }
    }
}
