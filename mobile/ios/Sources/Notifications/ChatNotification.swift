import Foundation
import Observation

struct ChatNotification: Codable, Identifiable, Equatable, Sendable {
    struct Target: Codable, Equatable, Sendable {
        let hostId: String
        let locationId: String
        let teamId: String
        let agentId: String
        let sessionId: String?
    }
    enum Kind: String, Codable, Sendable { case completed, approval, question }
    let id: String
    let target: Target
    let kind: Kind
    let name: String
    let createdAt: Double
    var message: String {
        switch kind {
        case .completed: "Finished its turn"
        case .approval: "Needs your approval"
        case .question: "Has a question for you"
        }
    }
    var symbol: String {
        switch kind {
        case .completed: "checkmark"
        case .approval: "hand.raised.fill"
        case .question: "questionmark"
        }
    }
    var initials: String { String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased() }
}

/// Banners are transient; dismissing one never changes the daemon's unread state.
@Observable
final class NotificationInbox {
    private(set) var current: ChatNotification?
    private var queued: [ChatNotification] = []
    private var seen: [String] = []

    func receive(_ notification: ChatNotification, foreground: Bool, visible: ChatNotification.Target?, now: Double = Date().timeIntervalSince1970 * 1000) {
        guard !seen.contains(notification.id) else { return }
        remember(notification.id)
        guard foreground, notification.target != visible, abs(now - notification.createdAt) <= 300_000 else { return }
        if current == nil { current = notification }
        else { queued.append(notification); if queued.count > 8 { queued.removeFirst() } }
    }
    func remember(_ id: String) {
        guard !seen.contains(id) else { return }
        seen.append(id); if seen.count > 256 { seen.removeFirst() }
    }
    func dismiss(id: String) {
        guard current?.id == id else { return }
        current = queued.isEmpty ? nil : queued.removeFirst()
    }
    func visibleChanged(_ target: ChatNotification.Target?) {
        queued.removeAll { $0.target == target }
        if current?.target == target, let id = current?.id { dismiss(id: id) }
    }
    func clear() { current = nil; queued.removeAll() }
}
