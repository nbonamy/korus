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
                if model.loadingConversation {
                    // Keep the WebView painting underneath until it acknowledges the selected frame.
                    ZStack {
                        Color(.systemBackground).ignoresSafeArea()
                        ProgressView("Loading conversation…")
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let request = model.requests.first {
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
                        .background(.regularMaterial)
                        .accessibilityLabel("Review request: \(request.title)")
                    }
                    ComposerView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation(.smooth(duration: 0.32)) { model.drawerOpen.toggle() }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .overlay(alignment: .topTrailing) {
                                if model.teams.hasUnreadActivity {
                                    UnreadDot().offset(x: 5, y: -5).accessibilityHidden(true)
                                }
                            }
                    }
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Agents")
                    .accessibilityValue(model.teams.hasUnreadActivity ? "Unread activity" : "")
                }
                ToolbarItem(placement: .principal) { HeaderTitle() }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Restart Session", systemImage: "arrow.clockwise") { model.restartSession() }
                            .disabled(!model.canManageSession || model.isWorking)
                        Button("Close Session", systemImage: "xmark", role: .destructive) { model.closeSession() }
                            .disabled(!model.canManageSession)
                    } label: {
                        if model.sessionAction == "previewClose" { ProgressView() }
                        else { Image(systemName: "ellipsis") }
                    }
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Session actions")
                }
            }
            .toolbarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: Binding(get: { model.reviewOpen }, set: { model.reviewOpen = $0; if !$0 { model.command("dismissReview") } })) {
                ReviewSetupView()
            }
            .sheet(item: Binding(get: { model.presentedRequest }, set: { model.presentedRequest = $0 })) { request in
                RequestSheet(pending: request)
            }
            .sheet(item: Binding(get: { model.closePreview }, set: { if $0 == nil { model.cancelCloseSession() } })) { preview in
                CloseSessionSheet(preview: preview)
            }
            .alert("Session action failed", isPresented: Binding(get: { model.sessionActionFailed && model.closePreview == nil }, set: { if !$0 { model.dismissSessionError() } })) {
                Button("OK", role: .cancel) { model.dismissSessionError() }
            } message: { Text("The laptop couldn’t complete the action. Check the connection and try again.") }
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
