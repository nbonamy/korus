import Foundation
import Observation

struct ChatNotification: Codable, Identifiable, Equatable, Sendable {
    struct Target: Codable, Hashable, Sendable {
        let hostId: String
        let locationId: String
        let teamId: String
        let agentId: String
        let sessionId: String?
    }
    enum Kind: String, Codable, Sendable { case completed, approval, question, read }
    let id: String
    let target: Target
    let kind: Kind
    let name: String
    let createdAt: Double
    var revision: Int? = nil
    var message: String {
        switch kind {
        case .completed: "Finished its turn"
        case .approval: "Needs your approval"
        case .question: "Has a question for you"
        case .read: ""
        }
    }
    var symbol: String {
        switch kind {
        case .completed: "checkmark"
        case .approval: "hand.raised.fill"
        case .question: "questionmark"
        case .read: ""
        }
    }
    func precedes(_ other: ChatNotification) -> Bool {
        if let revision, let next = other.revision, revision != next { return revision < next }
        return createdAt < other.createdAt
    }
    var initials: String { String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased() }
}

/// Read checkpoints are durable presentation metadata, independent of banner dismissal.
final class NotificationReadState {
    private let defaults: UserDefaults?
    private var memory: [String: Int] = [:]
    private let storageKey = "notifications.readRevisions"
    init(defaults: UserDefaults? = .standard) { self.defaults = defaults }
    private func key(_ target: ChatNotification.Target) -> String {
        String(data: try! JSONEncoder().encode([target.hostId, target.locationId, target.teamId, target.agentId]), encoding: .utf8)!
    }
    private var values: [String: Int] { defaults?.dictionary(forKey: storageKey) as? [String: Int] ?? memory }
    func apply(_ notification: ChatNotification) {
        guard notification.kind == .read, let revision = notification.revision, revision >= 0 else { return }
        var next = values; let key = key(notification.target)
        guard revision > (next[key] ?? -1) else { return }
        next[key] = revision
        defaults?.set(next, forKey: storageKey); memory = next
    }
    func contains(_ notification: ChatNotification) -> Bool {
        guard notification.kind != .read, let revision = notification.revision, let read = values[key(notification.target)] else { return false }
        return revision <= read
    }
}

/// Banners are transient; dismissing one never changes the daemon's unread state.
@Observable
final class NotificationInbox {
    private let reads: NotificationReadState
    init(reads: NotificationReadState = NotificationReadState()) { self.reads = reads }
    private(set) var current: ChatNotification?
    private var queued: [ChatNotification] = []
    private var seen: [String] = []
    private var latest: [ChatNotification.Target: ChatNotification] = [:]

    func receive(_ notification: ChatNotification, foreground: Bool, visible: ChatNotification.Target?, now: Double = Date().timeIntervalSince1970 * 1000) {
        if notification.kind == .read {
            reads.apply(notification)
            queued.removeAll { reads.contains($0) }
            if let current, reads.contains(current) { self.current = queued.isEmpty ? nil : queued.removeFirst() }
            return
        }
        guard !reads.contains(notification), !seen.contains(notification.id) else { return }
        if let previous = latest[notification.target], notification.precedes(previous) { return }
        latest[notification.target] = notification
        if latest.count > 256, let oldest = latest.min(by: { $0.value.createdAt < $1.value.createdAt })?.key { latest.removeValue(forKey: oldest) }
        remember(notification.id)
        guard foreground, notification.target != visible, abs(now - notification.createdAt) <= 300_000 else { return }
        if current == nil || current?.target == notification.target { current = notification }
        else if let index = queued.firstIndex(where: { $0.target == notification.target }) { queued[index] = notification }
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
