import Foundation
import Observation
import UIKit

/// Everything the screens render. The engine fills it from the laptop; fixtures fill it for previews and the debug menu.
@Observable
@MainActor
final class AppModel {
    var connection: ConnectionState = .unpaired
    var laptops: [EngineState.Laptop] = []
    var pairing: EngineState.Pairing = .idle
    var pairingError = ""
    var teams: [Team] = []
    var teamID = ""
    var groups: [SidebarGroup] = []
    var activeAgentID: String?
    var header: ConversationHeader?
    var models: [ModelChoice] = []
    var selectedModelID: String?
    var selectedEffort: String?
    var planMode = false
    var approvalPreset: String?
    var approvalPresets: [String] = []
    var canSend = false
    var composerText = ""
    var drawerOpen = false
    var isDictating = false
    var isLive = false

    let engine = EngineHost()
    let transcript = TranscriptHost()

    init() {
        engine.onState = { [weak self] state in self?.apply(state) }
        engine.onConversation = { [weak self] json in self?.transcript.setConversation(json) }
        transcript.onLoadOlder = { [weak self] id in self?.command("loadOlder", ["agentId": id]) }
        isLive = true
    }

    /// The visible product name, from the bundle's Info.plist (which the generated config fills from product.json).
    var productName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? "Companion"
    }

    var selectedModel: ModelChoice? { models.first { $0.id == selectedModelID } }

    /// A saved pairing exists but the link is not up: the person picks it, or it reconnects on its own.
    var needsPairing: Bool { connection == .unpaired || connection == .revoked || (groups.isEmpty && connection != .connecting && connection != .reconnecting && connection != .connected) }

    // MARK: Engine

    private func apply(_ state: EngineState) {
        connection = state.connection
        laptops = state.laptops
        pairing = state.pairing
        pairingError = state.pairingError
        teams = state.teams
        teamID = state.teamId
        groups = state.groups.map { group in
            SidebarGroup(id: group.id, kind: group.kind, label: group.label, icon: group.icon,
                         sessions: group.sessions.map { SidebarSession(agentId: $0.agentId, title: $0.displayTitle, kind: $0.kind, status: $0.status.type) })
        }
        activeAgentID = state.agentId.isEmpty ? nil : state.agentId
        header = state.header.map {
            ConversationHeader(title: $0.title, repository: $0.repository, status: $0.status,
                               statusText: $0.statusText == $0.status.rawValue ? $0.status.label : $0.statusText, icon: $0.icon)
        }
        models = state.models.map { ModelChoice(id: $0.id, name: $0.name, efforts: $0.efforts) }
        selectedModelID = state.composer.modelId
        selectedEffort = state.composer.effort
        planMode = state.composer.planMode
        approvalPreset = state.permissions.approvalPreset
        approvalPresets = state.permissions.presets
        canSend = state.canSend
    }

    func command(_ type: String, _ fields: [String: Any] = [:]) {
        engine.dispatch(["type": type].merging(fields) { _, new in new })
    }

    // MARK: Actions

    func select(agent id: String) {
        drawerOpen = false
        command("selectAgent", ["id": id])
    }

    func select(team id: String) { command("selectTeam", ["id": id]) }

    func pair(code: String) { command("pair", ["code": code, "deviceName": UIDevice.current.model]) }

    func send() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        composerText = ""
        command("send", ["text": text])
    }

    func chooseModel(_ id: String) { command("composer", ["change": ["modelId": id]]) }
    func chooseEffort(_ effort: String) { command("composer", ["change": ["reasoningEffort": effort.lowercased()]]) }
    func setPlanMode(_ on: Bool) { command("composer", ["change": ["planMode": on]]) }
    func setApprovalPreset(_ preset: String) { command("approvalPreset", ["preset": preset]) }
    func interrupt() { command("interrupt") }
    func disconnect() { command("disconnect") }
    func reconnect() { command("reconnect") }
    func forget() { command("forget") }
    func setActive(_ active: Bool) { command("activity", ["active": active]) }
}

extension AgentStatus {
    var label: String {
        switch self {
        case .idle: "Idle"
        case .working: "Working"
        case .awaitingInput: "Needs input"
        case .error: "Error"
        }
    }
}
