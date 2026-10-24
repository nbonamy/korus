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

enum LaptopSummary {
    /// What the Connections row shows: the laptop's name, or how many there are.
    static func text(names: [String]) -> String {
        switch names.count {
        case 0: "None"
        case 1: names[0]
        default: "\(names.count) laptops"
        }
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
