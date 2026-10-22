import XCTest
@testable import CompanionNotifications

final class NotificationInboxTests: XCTestCase {
    private let target = ChatNotification.Target(hostId: "host", locationId: "local", teamId: "team", agentId: "chat", sessionId: "session")
    private func event(_ id: String, time: Double = 1000) -> ChatNotification {
        .init(id: id, target: target, kind: .completed, name: "Mobile companion", createdAt: time)
    }
    // Acknowledging an older turn must clear its banner, preserve newer work, and
    // prevent delayed push delivery from bringing the old alert back.
    func testReadCheckpointClearsOnlyOlderAlertsAndSurvivesInboxRecreation() throws {
        let suite = "notification-read-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func decode(_ kind: String, _ revision: Int, _ id: String) throws -> ChatNotification {
            let base = try JSONSerialization.jsonObject(with: JSONEncoder().encode(event(id))) as! [String: Any]
            return try JSONDecoder().decode(ChatNotification.self, from: JSONSerialization.data(withJSONObject: base.merging(["kind": kind, "revision": revision]) { _, new in new }))
        }
        let inbox = NotificationInbox(reads: NotificationReadState(defaults: defaults))
        let old = try decode("completed", 1, "old"), newer = try decode("completed", 2, "new")
        inbox.receive(old, foreground: true, visible: nil, now: 1000)
        inbox.receive(newer, foreground: true, visible: nil, now: 1000)
        inbox.receive(try decode("read", 1, "read"), foreground: false, visible: nil, now: 1000)
        XCTAssertEqual(inbox.current?.id, "new")
        let restored = NotificationInbox(reads: NotificationReadState(defaults: defaults))
        restored.receive(old, foreground: true, visible: nil, now: 1000)
        XCTAssertNil(restored.current)
        restored.receive(newer, foreground: true, visible: nil, now: 1000)
        XCTAssertEqual(restored.current?.id, "new")
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
