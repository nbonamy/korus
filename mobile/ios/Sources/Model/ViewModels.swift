import Foundation

/// How the phone is connected to the laptop.
enum ConnectionState: String, Codable, Sendable {
    case unpaired, connecting, connected, disconnected, reconnecting, revoked, error
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

    var hasQuickChats: Bool { kind == .quickChats && !sessions.isEmpty }

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
    let id: String
    let name: String
    var efforts: [String] = []
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
    var status: Status = .idle
    var items: [Branch] = []

    func matching(_ query: String) -> [Branch] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? items : items.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }
}
