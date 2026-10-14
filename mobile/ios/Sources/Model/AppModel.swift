import Foundation
import Observation
import UIKit

/// Everything the screens render. The engine fills it from the laptop; fixtures fill it for previews and the debug menu.
@Observable
@MainActor
final class AppModel {
    var startup: EngineState.Startup = .loading
    private var conversationLoading = ConversationLoadingState()
    var loadingConversation: Bool { conversationLoading.isLoading }
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
    var canInterrupt = false
    var sessionAction: String?
    var sessionActionFailed = false
    var requests: [PendingRequest] = []
    var presentedRequest: PendingRequest?
    var respondingRequest: String?
    var failedRequest: String?
    var closePreview: EngineState.ClosePreview?
    var chatCreation: EngineState.ChatCreation = .idle
    var backends: [String] = []
    /// The repository a worktree is being named for; the sheet shows while it is set.
    var newWorktreeGroup: SidebarGroup?
    var creatingChatGroupID: String?
    /// The engine new chats start with, remembered between launches; unavailable ones fall back to the first the laptop offers.
    var preferredBackend = UserDefaults.standard.string(forKey: "newChat.backend") ?? "" {
        didSet { UserDefaults.standard.set(preferredBackend, forKey: "newChat.backend") }
    }
    var newChatBackend: String? { backends.contains(preferredBackend) ? preferredBackend : backends.first }
    var isWorking: Bool { header?.status == .working || header?.status == .awaitingInput }
    var canManageSession: Bool { activeAgentID != nil && connection == .connected && sessionAction == nil }
    let composerDrafts = ComposerDrafts()
    var composerText: String { get { composerDrafts.text } set { composerDrafts.text = newValue } }
    var supportsAttachments = false
    var skills = EngineState.Skills()
    var drawerOpen = false
    let dictation = DictationController(capture: AppleDictationCapture())
    var isLive = false

    let engine = EngineHost()
    let transcript = TranscriptHost()

    init() {
        engine.onSendResult = { [weak self] result in self?.composerDrafts.completeSend(result) }
        engine.onState = { [weak self] state in self?.apply(state) }
        engine.onTranscript = { [weak self] kind, json in self?.transcript.submit(kind, json) }
        engine.onContent = { [weak self] json in self?.transcript.receiveContent(json) }
        transcript.onReadContent = { [weak self] request in self?.engine.dispatch(request) }
        transcript.onChooseBackend = { [weak self] backend in self?.chooseBackend(backend) }
        transcript.onLoadOlder = { [weak self] id in self?.command("loadOlder", ["agentId": id]) }
        transcript.onRendered = { [weak self] id in
            guard let self, id == self.activeAgentID else { return }
            self.conversationLoading.rendered()
        }
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

    /// The engine repeats its whole state on every change. Writing an unchanged value still wakes every view that read it,
    /// so each property is written only when it differs.
    private func set<Value: Equatable>(_ keyPath: ReferenceWritableKeyPath<AppModel, Value>, _ value: Value) {
        if self[keyPath: keyPath] != value { self[keyPath: keyPath] = value }
    }

    private func apply(_ state: EngineState) {
        set(\.startup, state.startup)
        conversationLoading.update(fetching: state.loading, failed: !state.error.isEmpty, hasAgent: !state.agentId.isEmpty)
        set(\.requests, state.requests ?? [])
        set(\.respondingRequest, state.respondingRequest)
        set(\.failedRequest, state.failedRequest)
        if let shown = presentedRequest, !requests.contains(where: { $0.key == shown.key }) { presentedRequest = nil }
        set(\.connection, state.connection)
        set(\.laptops, state.laptops)
        set(\.pairing, state.pairing)
        set(\.pairingError, state.pairingError)
        set(\.teams, state.teams)
        set(\.teamID, state.teamId)
        let created = chatCreation == .creating && state.chatCreation == .idle
        set(\.chatCreation, state.chatCreation)
        if state.chatCreation != .creating { set(\.creatingChatGroupID, nil) }
        set(\.backends, state.backends)
        if created { newWorktreeGroup = nil; drawerOpen = false }
        set(\.groups, state.groups.map { group in
            SidebarGroup(id: group.id, kind: group.kind, label: group.label, icon: group.icon,
                         sessions: group.sessions.map { SidebarSession(agentId: $0.agentId, title: $0.displayTitle, kind: $0.kind, status: $0.status.type) },
                         repositoryId: group.repositoryRoot)
        })
        let nextAgentID = state.agentId.isEmpty ? nil : state.agentId
        if activeAgentID != nextAgentID { dictation.cancel() }
        set(\.activeAgentID, nextAgentID)
        set(\.header, state.header.map {
            ConversationHeader(title: $0.title, repository: $0.repository, status: $0.status,
                               statusText: $0.statusText == $0.status.rawValue ? $0.status.label : $0.statusText, icon: $0.icon)
        })
        set(\.models, state.models.map { ModelChoice(id: $0.id, name: $0.name, efforts: $0.efforts) })
        set(\.skills, state.skills ?? EngineState.Skills())
        set(\.selectedModelID, state.composer.modelId)
        set(\.selectedEffort, state.composer.effort)
        set(\.planMode, state.composer.planMode)
        set(\.approvalPreset, state.permissions.approvalPreset)
        set(\.approvalPresets, state.permissions.presets)
        composerDrafts.select(state.composerTarget)
        set(\.supportsAttachments, state.capabilities.attachments)
        set(\.canSend, state.canSend)
        set(\.canInterrupt, state.capabilities.interrupt)
        set(\.sessionAction, state.sessionAction)
        set(\.sessionActionFailed, state.sessionActionFailed)
        set(\.closePreview, state.closePreview?.isLinkedWorktree == true ? state.closePreview : nil)
    }

    func command(_ type: String, _ fields: [String: Any] = [:]) {
        engine.dispatch(["type": type].merging(fields) { _, new in new })
    }

    // MARK: Actions

    func select(agent id: String) {
        drawerOpen = false
        guard id != activeAgentID else { return }
        dictation.cancel()
        conversationLoading.select()
        transcript.beginSelection()
        command("selectAgent", ["id": id])
    }

    func select(team id: String) { dictation.cancel(); command("selectTeam", ["id": id]) }

    func pair(code: String) { command("pair", ["code": code, "deviceName": UIDevice.current.model]) }

    func send() {
        guard canSend, supportsAttachments || composerDrafts.items.isEmpty else { return }
        dictation.cancel()
        guard let request = composerDrafts.beginSend() else { return }
        do {
            let data = try JSONEncoder().encode(request)
            guard let command = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
            engine.dispatch(command)
        } catch { composerDrafts.completeSend(.init(requestId: request.requestId, status: .rejected)) }
    }

    func chooseModel(_ id: String) { command("composer", ["change": ["modelId": id]]) }
    func chooseEffort(_ effort: String) { command("composer", ["change": ["reasoningEffort": effort.lowercased()]]) }
    func setPlanMode(_ on: Bool) { command("composer", ["change": ["planMode": on]]) }
    func setApprovalPreset(_ preset: String) { command("approvalPreset", ["preset": preset]) }
    func interrupt() { command("interrupt") }
    func restartSession() { dictation.cancel(); command("restartSession") }
    func closeSession() { dictation.cancel(); command("closeSession") }
    func confirmCloseSession(_ id: String, deleteWorktree: Bool, deleteRemoteBranch: Bool = false, discardChanges: Bool = false) {
        command("confirmCloseSession", ["agentId": id, "deleteWorktree": deleteWorktree, "deleteRemoteBranch": deleteRemoteBranch, "discardChanges": discardChanges])
    }
    func cancelCloseSession() { if sessionAction == nil { closePreview = nil; command("cancelCloseSession") } }
    func dismissSessionError() { sessionActionFailed = false; command("dismissSessionError") }
    /// An empty chat takes another engine, and later new chats start with the one chosen last.
    func chooseBackend(_ backend: String) {
        preferredBackend = backend
        command("backend", ["backend": backend])
    }
    func startChat(in group: SidebarGroup, branchName: String? = nil) {
        guard let repositoryId = group.repositoryId, let backend = newChatBackend, chatCreation != .creating else { return }
        creatingChatGroupID = group.id
        command("newChat", ["repositoryId": repositoryId, "backend": backend].merging(branchName.map { ["branchName": $0] } ?? [:]) { _, new in new })
    }
    /// A conversation with no repository: one tap, the engine chosen in the empty chat.
    static let quickChatID = "quick-chat"
    var canStartChat: Bool { connection == .connected && !backends.isEmpty && !teamID.isEmpty }
    func startQuickChat() {
        guard let backend = newChatBackend, chatCreation != .creating else { return }
        creatingChatGroupID = Self.quickChatID
        command("newQuickChat", ["backend": backend])
    }
    func closeWorktreeSheet() { if chatCreation != .creating { newWorktreeGroup = nil; dismissChatFailure() } }
    func dismissChatFailure() { if chatCreation == .failed { chatCreation = .idle; command("dismissNewChat") } }
    func disconnect() { command("disconnect") }
    func reconnect() { command("reconnect") }
    func forget() { command("forget") }
    func setActive(_ active: Bool) {
        if !active { dictation.cancel() }
        command("activity", ["active": active])
    }
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
