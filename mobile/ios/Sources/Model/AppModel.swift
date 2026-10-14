import Foundation
import Observation
import UIKit

/// Everything the screens render. The engine fills it from the laptop; fixtures fill it for previews and the debug menu.
@Observable
@MainActor
final class AppModel {
    let notifications = NotificationInbox()
    let push = PushNotifications.shared
    var notificationError: String?
    var pushRegistrationFailed = false
    private var pendingNotification: ChatNotification?
    private var foreground = true
    private var screenUnlocked = false
    var startup: EngineState.Startup = .loading
    private var conversationLoading = ConversationLoadingState()
    var loadingConversation: Bool { conversationLoading.isLoading }
    var conversationLoadFailed: Bool { conversationLoading.failed }
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
    var supportsGoals = false
    var goal: EngineState.Goal?
    var goalBusy = false
    var goalError = false
    var goalMode: Bool { composerDrafts.goalMode }
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
    var existingBranchGroup: SidebarGroup?
    var branches = RepositoryBranches()
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
    var reviewOpen = false { didSet { if oldValue && !reviewOpen { acknowledgeRead() } } }
    var presentedImage: ImagePreview? {
        didSet {
            if presentedImage == nil { acknowledgeRead() }
            notifications.visibleChanged(visibleNotificationTarget)
        }
    }
    var reviewState = ReviewState()
    var mentions = EngineState.Suggestions()
    var skills = EngineState.Suggestions()
    private var conversationRead = ConversationReadState()
    var drawerOpen = false { didSet { if !drawerOpen { acknowledgeRead(); notifications.visibleChanged(visibleNotificationTarget) } } }
    let dictation = DictationController(capture: AppleDictationCapture())
    var isLive = false

    let engine = EngineHost()
    let transcript = TranscriptHost()

    init() {
        engine.onNotification = { [weak self] notification in self?.receive(notification) }
        engine.onNotificationOpenFailed = { [weak self] in self?.notificationError = "This conversation is unavailable. Check the laptop connection and try again." }
        push.onNotification = { [weak self] notification, tapped in
            if tapped { self?.open(notification) } else { self?.receive(notification) }
        }
        push.onRegistration = { [weak self] registration in
            self?.command("pushRegistration", ["registration": registration as Any? ?? NSNull()])
        }
        push.flush()

        engine.onSendResult = { [weak self] result in self?.composerDrafts.completeSend(result) }
        engine.onState = { [weak self] state in self?.apply(state) }
        engine.onTranscript = { [weak self] kind, json in self?.transcript.submit(kind, json) }
        engine.onContent = { [weak self] json in self?.transcript.receiveContent(json) }
        transcript.onOpenImage = { [weak self] agentID, image in
            guard let self, agentID == self.activeAgentID else { return }
            self.dictation.cancel()
            self.presentedImage = image
        }
        transcript.onReadContent = { [weak self] request in self?.engine.dispatch(request) }
        transcript.onChooseBackend = { [weak self] backend in self?.chooseBackend(backend) }
        transcript.onLoadOlder = { [weak self] id in self?.command("loadOlder", ["agentId": id]) }
        transcript.onRendered = { [weak self] id, revision in
            guard let self, id == self.activeAgentID else { return }
            self.conversationLoading.rendered()
            self.conversationRead.didRender(agentId: id, revision: revision)
            self.acknowledgeRead()
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
        set(\.pushRegistrationFailed, state.pushRegistrationFailed ?? false)
        conversationLoading.update(fetching: state.loading, failed: state.error == "mobile.errors.loadConversation", hasAgent: !state.agentId.isEmpty)
        set(\.requests, state.requests ?? [])
        set(\.respondingRequest, state.respondingRequest)
        set(\.failedRequest, state.failedRequest)
        if let shown = presentedRequest, !requests.contains(where: { $0.key == shown.key }) { presentedRequest = nil }
        set(\.connection, state.connection)
        set(\.laptops, state.laptops)
        set(\.pairing, state.pairing)
        set(\.pairingError, state.pairingError)
        set(\.teams, state.teams)
        if teamID != state.teamId { existingBranchGroup = nil }
        set(\.teamID, state.teamId)
        let created = chatCreation == .creating && state.chatCreation == .idle
        set(\.chatCreation, state.chatCreation)
        if state.chatCreation != .creating { set(\.creatingChatGroupID, nil) }
        set(\.backends, state.backends)
        if created { newWorktreeGroup = nil; existingBranchGroup = nil; drawerOpen = false }
        set(\.branches, state.branches ?? RepositoryBranches())
        set(\.groups, state.groups.map { group in
            SidebarGroup(id: group.id, kind: group.kind, label: group.label, icon: group.icon,
                         sessions: group.sessions.map { SidebarSession(agentId: $0.agentId, title: $0.displayTitle, kind: $0.kind, status: $0.status.type, isUnread: $0.isUnread ?? false) },
                         repositoryId: group.repositoryRoot)
        })
        let nextAgentID = state.agentId.isEmpty ? nil : state.agentId
        let agentChanged = activeAgentID != nextAgentID
        if agentChanged { dictation.cancel() }
        set(\.activeAgentID, nextAgentID)
        if agentChanged { reviewOpen = false; presentedImage = nil }
        set(\.header, state.header.map {
            ConversationHeader(title: $0.title, repository: $0.repository, status: $0.status,
                               statusText: $0.statusText == $0.status.rawValue ? $0.status.label : $0.statusText, icon: $0.icon)
        })
        set(\.models, state.models.map { ModelChoice(id: $0.id, name: $0.name, efforts: $0.efforts) })
        set(\.mentions, state.mentions ?? EngineState.Suggestions())
        set(\.skills, state.skills ?? EngineState.Suggestions())
        set(\.selectedModelID, state.composer.modelId)
        set(\.selectedEffort, state.composer.effort)
        set(\.planMode, state.composer.planMode)
        set(\.approvalPreset, state.permissions.approvalPreset)
        set(\.approvalPresets, state.permissions.presets)
        if let target = composerDrafts.target, target != state.composerTarget { reviewOpen = false; presentedImage = nil }
        composerDrafts.select(state.composerTarget)
        set(\.supportsGoals, state.capabilities.goals ?? false)
        set(\.goal, state.goal)
        set(\.goalBusy, state.goalBusy ?? false)
        set(\.goalError, state.goalError ?? false)
        if !supportsGoals || planMode { composerDrafts.setGoalMode(false) }
        set(\.reviewState, state.review ?? ReviewState())
        if state.review?.status == .started { reviewOpen = false }
        set(\.supportsAttachments, state.capabilities.attachments)
        set(\.canSend, state.canSend)
        set(\.canInterrupt, state.capabilities.interrupt)
        set(\.sessionAction, state.sessionAction)
        set(\.sessionActionFailed, state.sessionActionFailed)
        set(\.closePreview, state.closePreview?.isLinkedWorktree == true ? state.closePreview : nil)
        notifications.visibleChanged(visibleNotificationTarget)
        if startup == .ready, let notification = pendingNotification { pendingNotification = nil; open(notification) }
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

    func retryConversation() {
        guard let id = activeAgentID, connection == .connected else { return }
        conversationLoading.select()
        transcript.beginSelection()
        command("selectAgent", ["id": id])
    }

    func pair(code: String) { command("pair", ["code": code, "deviceName": UIDevice.current.model]) }

    func send() {
        guard canSend, !goalMode || supportsGoals, supportsAttachments || composerDrafts.items.isEmpty else { return }
        dictation.cancel()
        guard let request = composerDrafts.beginSend() else { return }
        do {
            let data = try JSONEncoder().encode(request)
            guard let command = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
            engine.dispatch(command)
        } catch { composerDrafts.completeSend(.init(requestId: request.requestId, status: .rejected)) }
    }

    func openReview() {
        guard canManageSession else { return }
        dictation.cancel()
        reviewOpen = true
        command("loadReview")
    }

    func startReview(_ choices: ReviewChoices) {
        guard canSend, reviewState.status == .ready, let setup = reviewState.setup, let input = choices.input(setup),
              let data = try? JSONEncoder().encode(input),
              let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let targetData = try? JSONEncoder().encode(setup.target),
              let target = try? JSONSerialization.jsonObject(with: targetData) else { return }
        command("review", ["input": fields, "target": target])
    }

    func chooseModel(_ id: String) { command("composer", ["change": ["modelId": id]]) }
    func chooseEffort(_ effort: String) { command("composer", ["change": ["reasoningEffort": effort.lowercased()]]) }
    func setPlanMode(_ on: Bool) {
        if on { composerDrafts.setGoalMode(false) }
        planMode = on
        command("composer", ["change": ["planMode": on]])
    }
    func setGoalMode(_ on: Bool) {
        guard supportsGoals else { return }
        composerDrafts.setGoalMode(on)
        if composerDrafts.goalMode { setPlanMode(false) }
    }
    func editGoal() {
        guard let goal, canSend, composerDrafts.items.isEmpty, !composerDrafts.importing, !composerDrafts.sending else { return }
        dictation.cancel()
        setGoalMode(true)
        composerText = goal.objective
    }
    func clearGoal() {
        guard canSend, supportsGoals, !goalBusy, let target = composerDrafts.target,
              let data = try? JSONEncoder().encode(target), let fields = try? JSONSerialization.jsonObject(with: data) else { return }
        command("clearGoal", ["target": fields])
    }
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
    func startChat(in group: SidebarGroup, branchName: String? = nil, existingBranch: String? = nil) {
        guard canStartChat, let repositoryId = group.repositoryId, let backend = newChatBackend, chatCreation != .creating else { return }
        creatingChatGroupID = group.id
        var fields: [String: Any] = ["repositoryId": repositoryId, "backend": backend]
        if let existingBranch { fields["existingBranch"] = existingBranch }
        else if let branchName { fields["branchName"] = branchName }
        command("newChat", fields)
    }
    /// A conversation with no repository: one tap, the engine chosen in the empty chat.
    static let quickChatID = "quick-chat"
    var canStartChat: Bool { connection == .connected && !backends.isEmpty && !teamID.isEmpty }
    func startQuickChat() {
        guard let backend = newChatBackend, chatCreation != .creating else { return }
        creatingChatGroupID = Self.quickChatID
        command("newQuickChat", ["backend": backend])
    }
    func loadBranches(in group: SidebarGroup) {
        guard let repositoryId = group.repositoryId else { return }
        branches = RepositoryBranches(repositoryId: repositoryId, status: .loading)
        dismissChatFailure()
        command("loadBranches", ["repositoryId": repositoryId])
    }
    func closeBranchSheet() {
        guard chatCreation != .creating else { return }
        existingBranchGroup = nil
        branches = RepositoryBranches()
        command("dismissBranches")
        dismissChatFailure()
    }
    func closeWorktreeSheet() { if chatCreation != .creating { newWorktreeGroup = nil; dismissChatFailure() } }
    func dismissChatFailure() { if chatCreation == .failed { chatCreation = .idle; command("dismissNewChat") } }
    func disconnect() { command("disconnect") }
    func reconnect() { command("reconnect") }
    func forget() { command("forget") }
    private func acknowledgeRead() {
        guard let read = conversationRead.acknowledgement(activeAgentId: activeAgentID,
            foreground: foreground && UIApplication.shared.applicationState == .active, drawerOpen: drawerOpen, reviewOpen: reviewOpen, imageOpen: presentedImage != nil, unlocked: screenUnlocked) else { return }
        command("read", ["agentId": read.agentId, "revision": read.revision])
    }

    private var visibleNotificationTarget: ChatNotification.Target? {
        guard screenUnlocked, foreground, !drawerOpen, !reviewOpen, presentedImage == nil, let target = composerDrafts.target else { return nil }
        return .init(hostId: target.hostId, locationId: target.locationId, teamId: target.teamId, agentId: target.agentId, sessionId: target.sessionId)
    }
    func receive(_ notification: ChatNotification) {
        guard laptops.contains(where: { $0.id == notification.target.hostId }) else { return }
        notifications.receive(notification, foreground: foreground, visible: visibleNotificationTarget)
    }
    func open(_ notification: ChatNotification) {
        notifications.remember(notification.id)
        notifications.dismiss(id: notification.id)
        guard startup == .ready else { pendingNotification = notification; return }
        drawerOpen = false; reviewOpen = false
        let target = notification.target
        command("openNotification", ["target": ["hostId": target.hostId, "locationId": target.locationId,
            "teamId": target.teamId, "agentId": target.agentId, "sessionId": target.sessionId as Any? ?? NSNull()]])
    }
    func setActive(_ active: Bool) {
        foreground = active
        if active { Task { await push.refresh() } } else { notifications.clear() }
        if !active { dictation.cancel() }
        command("activity", ["active": active && screenUnlocked])
    }
    func setUnlocked(_ unlocked: Bool) {
        screenUnlocked = unlocked
        if !unlocked { dictation.cancel(); notifications.clear() }
        command("activity", ["active": unlocked && foreground])
        if unlocked { acknowledgeRead() }
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
