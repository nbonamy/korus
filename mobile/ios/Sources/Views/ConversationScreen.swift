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
            .safeAreaInset(edge: .bottom, spacing: 0) { ComposerView() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation(.smooth(duration: 0.32)) { model.drawerOpen.toggle() }
                    } label: { Image(systemName: "line.3.horizontal") }
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Agents")
                }
                ToolbarItem(placement: .principal) { HeaderTitle() }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Stop", systemImage: "stop.circle") { model.interrupt() }
                    } label: { Image(systemName: "ellipsis") }
                    .buttonBorderShape(.circle)
                }
            }
            .toolbarTitleDisplayMode(.inline)
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
