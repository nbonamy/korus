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
}

struct SidebarSession: Identifiable, Hashable, Codable, Sendable {
    let agentId: String
    let title: String
    let kind: SessionKind
    let status: AgentStatus
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
