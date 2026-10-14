import XCTest
@testable import CompanionNotifications

final class NotificationInboxTests: XCTestCase {
    private let target = ChatNotification.Target(hostId: "host", locationId: "local", teamId: "team", agentId: "chat", sessionId: "session")
    private func event(_ id: String, time: Double = 1000) -> ChatNotification {
        .init(id: id, target: target, kind: .completed, name: "Mobile companion", createdAt: time)
    }
    func testSuppressesVisibleBackgroundExpiredAndDuplicateEventsAcrossBothTransports() {
        let inbox = NotificationInbox()
        inbox.receive(event("visible"), foreground: true, visible: target, now: 1000)
        inbox.receive(event("background"), foreground: false, visible: nil, now: 1000)
        inbox.receive(event("expired", time: -400000), foreground: true, visible: nil, now: 1000)
        XCTAssertNil(inbox.current)
        inbox.receive(event("visible"), foreground: true, visible: nil, now: 1000)
        inbox.receive(event("background"), foreground: true, visible: nil, now: 1000)
        XCTAssertNil(inbox.current)
        inbox.receive(event("new"), foreground: true, visible: nil, now: 1000)
        XCTAssertEqual(inbox.current?.id, "new")
        inbox.receive(event("new"), foreground: true, visible: nil, now: 1000)
        inbox.dismiss(id: "new")
        XCTAssertNil(inbox.current)
    }
    func testQueuedBannersSurviveOldTimersAndDisappearWhenTheirConversationOpens() {
        let inbox = NotificationInbox()
        inbox.receive(event("first"), foreground: true, visible: nil, now: 1000)
        inbox.receive(event("second"), foreground: true, visible: nil, now: 1000)
        inbox.dismiss(id: "first")
        inbox.dismiss(id: "first")
        XCTAssertEqual(inbox.current?.id, "second")
        inbox.visibleChanged(target)
        XCTAssertNil(inbox.current)
        inbox.receive(event("third"), foreground: true, visible: nil, now: 1000)
        inbox.clear()
        XCTAssertNil(inbox.current)
        inbox.receive(event("third"), foreground: true, visible: nil, now: 1000)
        XCTAssertNil(inbox.current)
    }
}
