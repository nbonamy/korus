import Foundation

/// Deterministic data for previews and the debug menu: the same views render it as render live data.
enum Fixtures {
    static let teams: [Team] = [
        Team(id: "korus", name: "Korus"), Team(id: "id", name: "id"), Team(id: "music", name: "music"), Team(id: "tv", name: "tv"),
    ]

    static let groups: [SidebarGroup] = [
        SidebarGroup(id: "quick", kind: .quickChats, label: "Chats", icon: nil, sessions: [
            SidebarSession(agentId: "chat-1", title: "Plan the release notes", kind: .folder, status: .idle),
            SidebarSession(agentId: "chat-2", title: "Untitled conversation", kind: .folder, status: .idle),
        ]),
        SidebarGroup(id: "git:korus", kind: .repository, label: "korus", icon: "K", sessions: [
            SidebarSession(agentId: "main", title: "main", kind: .main, status: .idle),
            SidebarSession(agentId: "mobile", title: "feat/mobile-companion", kind: .worktree, status: .working),
            SidebarSession(agentId: "perf", title: "perf/large-conversations", kind: .worktree, status: .idle),
        ]),
        SidebarGroup(id: "git:sdk", kind: .repository, label: "codex-app-sdk", icon: "⚙️", sessions: [
            SidebarSession(agentId: "sdk", title: "sdk", kind: .worktree, status: .awaitingInput),
            SidebarSession(agentId: "builder", title: "app-builder", kind: .worktree, status: .idle),
            SidebarSession(agentId: "sherpa", title: "Sherpa helper lifecycle", kind: .branch, status: .idle),
        ]),
        SidebarGroup(id: "git:website", kind: .repository, label: "website", icon: "🦞", sessions: [
            SidebarSession(agentId: "web-main", title: "main", kind: .main, status: .idle),
        ]),
    ]

    static let header = ConversationHeader(title: "main", repository: "korus", status: .idle, statusText: "Idle", icon: "K")

    static let models: [ModelChoice] = [
        ModelChoice(id: "gpt-6-sol", name: "GPT-6.1-Sol", efforts: ["Low", "Medium", "High", "Extra High"]),
        ModelChoice(id: "gpt-6-astra", name: "GPT-6-Astra", efforts: ["Low", "Medium", "High"]),
        ModelChoice(id: "gpt-6-sol-mini", name: "GPT-6-Sol Mini"),
    ]
}
