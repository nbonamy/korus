import SwiftUI

struct ConversationScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                TranscriptView(host: model.transcript)
                    .ignoresSafeArea()
                    .accessibilityHidden(model.loadingConversation)
                    .allowsHitTesting(!model.loadingConversation)
                    .onChange(of: proxy.safeAreaInsets, initial: true) { _, insets in
                        model.transcript.setInsets(top: insets.top, bottom: insets.bottom)
                    }
            }
            .overlay {
                if model.showConnectionLost && !model.hasTranscript {
                    ConnectionLostView(reconnect: model.reconnect)
                        .background(Color(.systemBackground).ignoresSafeArea())
                } else if model.conversationLoadFailed && !model.hasTranscript {
                    ContentUnavailableView {
                        Label("Couldn’t load this conversation", systemImage: "exclamationmark.bubble")
                    } description: { Text("Try again to reconnect to this conversation.") }
                    actions: { Button("Retry") { model.retryConversation() }.disabled(model.connection != .connected) }
                    .background(Color(.systemBackground).ignoresSafeArea())
                } else if model.loadingConversation {
                    // Keep the WebView painting underneath until it acknowledges the selected frame.
                    ZStack {
                        Color(.systemBackground).ignoresSafeArea()
                        ProgressView("Loading conversation…")
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if model.hasTranscript && (model.connection == .connected && (model.conversationLoadFailed || model.showUpdating) || model.showReconnecting) {
                    HStack(spacing: 7) {
                        if model.conversationLoadFailed {
                            Text("Couldn’t update")
                            Button("Retry") { model.retryConversation() }
                        } else {
                            ProgressView().controlSize(.mini)
                            Text(model.connection == .connected ? "Updating…" : "Reconnecting…")
                        }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 6)
                    .accessibilityElement(children: .contain)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if model.hasTranscript && model.showConnectionLost {
                    ConnectionLostNotice(reconnect: model.reconnect)
                    .padding(.horizontal, 20).padding(.vertical, 10)
                    .background(.bar)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let request = model.requests.first {
                        HStack(spacing: 0) {
                            Button {
                                model.dictation.cancel()
                                model.presentedRequest = request
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: request.request.kind == "question" ? "questionmark.bubble" : "hand.raised")
                                    Text(request.title).font(.subheadline.weight(.semibold))
                                    if model.requests.count > 1 { Text("(\(model.requests.count))") }
                                    Spacer()
                                    Text("Review").font(.subheadline)
                                    Image(systemName: "chevron.right").font(.caption)
                                }
                                .padding(.horizontal, 20).padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .accessibilityLabel("Review request: \(request.title)")
                            if request.request.kind == "question" {
                                Button { model.command("dismissRequest", ["key": request.key]) } label: {
                                    Image(systemName: "xmark").frame(width: 44, height: 44)
                                }
                                .disabled(model.respondingRequest == request.key)
                                .accessibilityLabel("Dismiss question")
                            }
                        }
                        .background(.regularMaterial)
                    }
                    // A mission's worker is driven by its mission; what it asks still arrives above.
                    if model.workerMission == nil { ComposerView() }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        if let mission = model.workerMission { model.showMissions(mission.id) } else { model.drawerOpen.toggle() }
                    } label: {
                        Image(systemName: model.workerMission == nil ? "line.3.horizontal" : "chevron.left")
                    }
                    .buttonBorderShape(.circle)
                    .toolbarDot(model.teams.hasUnreadActivity)
                    .accessibilityLabel(model.workerMission == nil ? "Agents" : "Back to mission")
                    .accessibilityValue(model.workerMission == nil && model.teams.hasUnreadActivity ? "Unread activity" : "")
                }
                ToolbarItem(placement: .principal) { HeaderTitle() }
                ToolbarItem(placement: .topBarTrailing) {
                    // A mission drives its workers: the phone can look at their changes and nothing else.
                    if model.workerMission == nil || model.git.available {
                        Menu {
                            if model.git.available {
                                Button("Changes", systemImage: "doc.text.magnifyingglass") { model.openChanges() }
                                    .disabled(!model.canManageSession)
                            }
                            if model.workerMission == nil {
                                if model.git.available { Divider() }
                                Button("Rename Agent", systemImage: "pencil") { model.openAgentRename() }
                                    .disabled(!model.canManageSession)
                                Button("Duplicate Agent", systemImage: "plus.square.on.square") { model.duplicateAgent() }
                                    .disabled(!model.canManageSession || !model.canStartChat || model.chatCreation == .creating)
                                Divider()
                                Button("Restart Session", systemImage: "arrow.clockwise") { model.restartSession() }
                                    .disabled(!model.canManageSession || model.isWorking)
                                Button("Close Session", systemImage: "xmark", role: .destructive) { model.closeSession() }
                                    .disabled(!model.canManageSession)
                            }
                        } label: {
                            if model.sessionAction == "previewClose" || model.duplicatingAgent { ProgressView() }
                            else { Image(systemName: "ellipsis") }
                        }
                        .buttonBorderShape(.circle)
                        .toolbarDot(model.git.uncommitted?.state == "dirty")
                        .accessibilityLabel("Session actions")
                        .accessibilityValue(model.duplicatingAgent ? "Duplicating agent" : model.git.uncommitted?.state == "dirty" ? "Uncommitted changes" : "")
                    }
                }
            }
            .toolbarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: Binding(get: { model.reviewOpen }, set: { model.reviewOpen = $0; if !$0 { model.command("dismissReview") } })) {
                ReviewSetupView()
            }
            .fullScreenCover(isPresented: Binding(get: { model.changesOpen }, set: { model.changesOpen = $0 })) { ChangesSheet() }
            .fullScreenCover(item: Binding(get: { model.presentedImage }, set: { model.presentedImage = $0 })) { image in
                ImageViewer(preview: image)
            }
            .sheet(item: Binding(get: { model.presentedRequest }, set: { model.presentedRequest = $0 })) { request in
                RequestSheet(pending: request)
            }
            .sheet(item: Binding(get: { model.closePreview }, set: { if $0 == nil { model.cancelCloseSession() } })) { preview in
                CloseSessionSheet(preview: preview)
            }
            .sheet(item: Binding(get: { model.agentRename }, set: { model.agentRename = $0 })) { draft in
                RenameAgentSheet(name: draft.name, enabled: model.canManageSession && model.composerDrafts.target == draft.target,
                    cancel: { model.agentRename = nil }, save: { model.renameAgent(draft.target, name: $0) })
            }
            .onChange(of: model.composerDrafts.target) { _, _ in model.agentRename = nil }
            .alert("Session action failed", isPresented: Binding(get: { model.sessionActionFailed && model.closePreview == nil }, set: { if !$0 { model.dismissSessionError() } })) {
                Button("OK", role: .cancel) { model.dismissSessionError() }
            } message: { Text("The laptop couldn’t complete the action. Check the connection and try again.") }
        }
    }
}

private extension View {
    func toolbarDot(_ visible: Bool) -> some View {
        self.frame(width: 44, height: 44)
            .overlay(alignment: .topTrailing) {
                if visible {
                    UnreadDot()
                        .overlay { Circle().stroke(Color(.systemBackground), lineWidth: 2) }
                        // The dot center sits on the 44-point circle at its upper-right diagonal.
                        .offset(x: -2.5, y: 2.5)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                }
            }
    }
}

private struct HeaderTitle: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let header = model.header {
            VStack(spacing: 1) {
                Text(header.title).font(.headline).lineLimit(1)
                HStack(spacing: 5) {
                    if header.status != .idle { Circle().fill(header.status == .error ? .red : .orange).frame(width: 6, height: 6) }
                    Text([header.repository, header.statusText].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        } else {
            Text(model.productName).font(.headline)
        }
    }
}
