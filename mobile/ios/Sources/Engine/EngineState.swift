import Foundation

/// The engine's state as it arrives from JSON; `AppModel` maps it onto the view models the screens draw.
struct EngineState: Decodable {
    struct Laptop: Decodable, Hashable { let id: String; let name: String }
    struct Session: Decodable {
        struct Status: Decodable { let type: AgentStatus }
        let agentId: String
        let displayTitle: String
        let kind: SessionKind
        let status: Status
    }
    struct Group: Decodable {
        let id: String
        let kind: GroupKind
        let label: String
        let icon: String?
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
    struct Mode: Decodable, Hashable { let id: String; let label: String }
    struct Permissions: Decodable { let approvalPreset: String?; let permissionMode: String?; let presets: [String]; let modes: [Mode] }
    struct Capabilities: Decodable { let models: Bool; let reasoningEffort: Bool; let serviceTier: Bool; let planMode: Bool; let interrupt: Bool; let attachments: Bool }
    enum Pairing: String, Decodable { case idle, working, awaitingApproval }

    enum Startup: String, Decodable { case loading, ready, error }

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
    let canSend: Bool
    let draft: String
    let models: [Model]
    let composer: Composer
    let permissions: Permissions
    let capabilities: Capabilities
}
