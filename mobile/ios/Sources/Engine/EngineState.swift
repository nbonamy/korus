import Foundation

/// The engine's state as it arrives from JSON; `AppModel` maps it onto the view models the screens draw.
struct EngineState: Decodable {
    struct Laptop: Decodable, Hashable { let id: String; let name: String }
    struct Session: Decodable {
        struct Status: Decodable { let type: AgentStatus }
        let agentId: String
        let displayTitle: String
        let kind: SessionKind
        let isUnread: Bool?
        let status: Status
    }
    struct Group: Decodable {
        let id: String
        let kind: GroupKind
        let label: String
        let icon: String?
        let repositoryRoot: String?
        let sessions: [Session]
    }
    struct Header: Decodable {
        let title: String
        let repository: String?
        let status: AgentStatus
        let statusText: String
        let icon: String?
    }
    struct Model: Decodable { let id: String; let name: String; let efforts: [String]; let tiers: [Tier] }
    struct Tier: Decodable, Hashable { let id: String; let name: String }
    struct Composer: Decodable { let modelId: String?; let effort: String?; let serviceTier: String?; let planMode: Bool }
    struct Suggestions: Decodable, Equatable {
        enum Status: String, Decodable { case idle, loading, loaded, failed }
        var status: Status = .idle
        var items: [ComposerSuggestion] = []
    }
    struct Mode: Decodable, Hashable { let id: String; let label: String }
    struct Permissions: Decodable { let approvalPreset: String?; let permissionMode: String?; let presets: [String]; let modes: [Mode] }
    struct Goal: Decodable, Equatable { let objective: String; let status: String }
    struct Capabilities: Decodable { let goals: Bool?; let models: Bool; let reasoningEffort: Bool; let serviceTier: Bool; let planMode: Bool; let interrupt: Bool; let attachments: Bool }
    struct ClosePreview: Decodable, Identifiable, Equatable {
        struct Target: Decodable, Equatable { let agentId: String }
        let target: Target
        let isLinkedWorktree: Bool
        let branch: String?
        let upstream: String?
        let hasChanges: Bool
        var id: String { target.agentId }
    }
    enum ChatCreation: String, Decodable { case idle, creating, failed }
    enum Pairing: String, Decodable { case idle, working, awaitingApproval }

    enum Startup: String, Decodable { case loading, ready, error }

    let requests: [PendingRequest]?
    let respondingRequest: String?
    let failedRequest: String?
    let startup: Startup
    let connection: ConnectionState
    let error: String
    let laptops: [Laptop]
    let pairing: Pairing
    let pairingError: String
    let teams: [Team]
    let teamId: String
    let groups: [Group]
    let agentId: String
    let header: Header?
    let loading: Bool
    let composerTarget: ComposerTarget?
    let goal: Goal?
    let goalBusy: Bool?
    let goalError: Bool?
    let review: ReviewState?
    let canSend: Bool
    let sessionAction: String?
    let sessionActionFailed: Bool
    let closePreview: ClosePreview?
    let chatCreation: ChatCreation
    let branches: RepositoryBranches?
    let backends: [String]
    let draft: String
    let models: [Model]
    let composer: Composer
    let skills: Suggestions?
    let mentions: Suggestions?
    let permissions: Permissions
    let capabilities: Capabilities
}
