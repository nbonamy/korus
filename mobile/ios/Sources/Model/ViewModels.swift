import Foundation

/// How the phone is connected to the laptop.
enum ConnectionState: String, Codable, Sendable {
    case unpaired, connecting, connected, disconnected, reconnecting, revoked, error
}

extension ConnectionState {
    /// One quiet line for the settings header; recovery stays "Connecting…" until the lost-connection notice would show.
    func summary(laptop: String?, lost: Bool) -> String? {
        switch self {
        case .connected: laptop.map { "Connected to \($0)" } ?? "Connected"
        case .unpaired, .revoked: nil
        case .connecting, .reconnecting, .disconnected, .error: lost ? "Connection lost" : "Connecting…"
        }
    }
}

enum LaptopName {
    static let maxLength = 60
    /// The name to save, or nil when the person has typed nothing usable.
    static func cleaned(_ value: String) -> String? {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || name.count > maxLength ? nil : name
    }
}

enum AgentStatus: String, Codable, Sendable {
    case idle, working, awaitingInput, error
}

enum SessionKind: String, Codable, Sendable {
    case main, branch, worktree, detached, folder
}

enum GroupKind: String, Codable, Sendable {
    case repository, folder, quickChats
}

struct Team: Identifiable, Hashable, Codable, Sendable {
    let id: String
    let name: String
    var avatar: String?
    var isUnread: Bool? = nil
}

extension Collection where Element == Team {
    var hasUnreadActivity: Bool { contains { $0.isUnread == true } }
}

struct SidebarSession: Identifiable, Hashable, Codable, Sendable {
    let agentId: String
    let title: String
    let kind: SessionKind
    let status: AgentStatus
    var isUnread = false
    var subtitle: String? = nil
    var quickChat = false
    var id: String { agentId }
}

struct SidebarGroup: Identifiable, Hashable, Codable, Sendable {
    let id: String
    let kind: GroupKind
    let label: String
    /// An emoji or image data URL chosen on the desktop.
    var icon: String?
    var sessions: [SidebarSession]
    /// Names the repository to the laptop when a chat starts in it; folders and quick chats have none.
    var repositoryId: String? = nil
    var activity: SidebarActivity? = nil

    var hasQuickChats: Bool { kind == .quickChats && !sessions.isEmpty }

    var imageIconData: Data? {
        guard let icon, icon.hasPrefix("data:image/"), let comma = icon.firstIndex(of: ","),
              icon[..<comma].hasSuffix(";base64"), icon.utf8.count <= 4 * 1024 * 1024 else { return nil }
        return Data(base64Encoded: String(icon[icon.index(after: comma)...]))
    }

    /// Custom letters get a badge; default folders and pictographs stand alone.
    var usesIconBadge: Bool {
        guard kind != .quickChats else { return false }
        guard let icon, !icon.isEmpty else { return false }
        return !icon.hasPrefix("data:image/") && icon.range(of: "\\p{Extended_Pictographic}", options: .regularExpression) == nil
    }
}

/// What the header shows for the open conversation.
struct ConversationHeader: Hashable, Codable, Sendable {
    let title: String
    let repository: String?
    let status: AgentStatus
    let statusText: String
    var icon: String?
}

struct ModelChoice: Identifiable, Hashable, Codable, Sendable {
    struct Tier: Identifiable, Hashable, Codable, Sendable {
        let id: String
        let name: String
    }
    let id: String
    let name: String
    var efforts: [String] = []
    var tiers: [Tier] = []
    var fastTier: Tier? { tiers.first { $0.id == "fast" || $0.id == "priority" } }
}

/// Repository-scoped branch choices from the laptop, without filesystem paths.
struct RepositoryBranches: Decodable, Equatable {
    enum Status: String, Decodable { case idle, loading, loaded, failed }
    struct Branch: Decodable, Equatable, Identifiable {
        let name: String
        let isDefault: Bool
        let isCheckedOut: Bool
        var id: String { name }
    }
    var repositoryId: String? = nil
    var activity: SidebarActivity? = nil
    var status: Status = .idle
    var items: [Branch] = []

    func matching(_ query: String) -> [Branch] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? items : items.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }
}

/// How a mission ticket reads on the phone: one label and symbol per state of the desktop's implementation board.
enum MissionTicketState: String {
    case blocked, queued, preparing, running, awaitingReview, accepted, cancelled, failed

    init(_ value: String) { self = MissionTicketState(rawValue: value) ?? .queued }

    var label: String {
        switch self {
        case .blocked: "Blocked"
        case .queued: "Queued"
        case .preparing: "Preparing"
        case .running: "In progress"
        case .awaitingReview: "Ready for review"
        case .accepted: "Done"
        case .cancelled: "Cancelled"
        case .failed: "Failed"
        }
    }

    var symbol: String {
        switch self {
        case .blocked: "lock"
        case .queued: "circle"
        case .preparing, .running: "circle.dotted"
        case .awaitingReview: "eye.circle"
        case .accepted: "checkmark.circle.fill"
        case .cancelled: "slash.circle"
        case .failed: "exclamationmark.circle.fill"
        }
    }
}

struct MissionTicketSummary: Decodable, Hashable, Identifiable {
    let number: Int; let title: String; let state: String; let agentId: String?
    /// The unfinished tickets this one waits for, and what its agent says it is doing right now.
    let after: [Int]?; let activity: String?
    var id: Int { number }
}

struct MissionSummary: Decodable, Hashable, Identifiable {
    let id: String; let outcome: String; let stage: String; let status: String; let done: Int; let tickets: [MissionTicketSummary]
    let startedAt: String?; let updatedAt: String?
    /// The ordinary agent leading the mission through its current stage.
    let leadAgentId: String?
}

/// The mission that owns the open worker conversation, if any.
struct MissionReference: Decodable, Equatable { let id: String; let outcome: String; let lead: Bool? }

extension MissionSummary {
    var isActive: Bool { status == "active" }

    var stageLabel: String {
        switch stage {
        case "requirements": "Requirements"
        case "tickets": "Tickets"
        case "implementation": "Implementation"
        case "review": "Review"
        case "ship": "Ship"
        default: stage.capitalized
        }
    }

    /// "Implementation · 3 of 7 tickets"; a mission still shaping its tickets says only where it is.
    var summary: String {
        guard !tickets.isEmpty else { return stageLabel }
        return "\(stageLabel) · \(done) of \(tickets.count) \(tickets.count == 1 ? "ticket" : "tickets")"
    }

    var progress: Double { tickets.isEmpty ? 0 : min(1, Double(done) / Double(tickets.count)) }
}

extension MissionSummary {
    static let stages = [("requirements", "Requirements", "doc.text"), ("tickets", "Tickets", "checklist"), ("implementation", "Implementation", "hammer"),
                         ("review", "Review", "eye"), ("ship", "Ship", "paperplane")]

    /// Tickets waiting on a person: an agent's work to look at, or work that failed.
    var attentionCount: Int { tickets.filter { [.awaitingReview, .failed].contains(MissionTicketState($0.state)) }.count }
    /// Agents on a ticket at this moment.
    var workingCount: Int { tickets.filter { [.running, .preparing].contains(MissionTicketState($0.state)) }.count }
    var isReadyToShip: Bool { isActive && !tickets.isEmpty && done == tickets.count }
    var stageIndex: Int { Self.stages.firstIndex { $0.0 == stage } ?? 0 }

    /// "11 Update onboarding copy": the ticket an agent is on, the first one when several are.
    var nowLine: String? {
        tickets.first { [.running, .preparing].contains(MissionTicketState($0.state)) }.map { "\(String(format: "%02d", $0.number)) \($0.title)" }
    }

    /// How long the work has been going: until now while it runs, until its last change once it is over.
    func elapsed(now: Date) -> TimeInterval? {
        guard let start = startedAt.flatMap(Self.parse) else { return nil }
        let end = isActive ? now : (updatedAt.flatMap(Self.parse) ?? now)
        return max(0, end.timeIntervalSince(start))
    }

    /// "2h 14m", "14m", or "Under a minute".
    static func elapsedText(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        if minutes < 1 { return "Under a minute" }
        if minutes < 60 { return "\(minutes)m" }
        if minutes < 24 * 60 { return "\(minutes / 60)h \(minutes % 60)m" }
        return "\(minutes / (24 * 60))d \(minutes % (24 * 60) / 60)h"
    }

    private static func parse(_ value: String) -> Date? {
        let precise = ISO8601DateFormatter(); precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
