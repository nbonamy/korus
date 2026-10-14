import SwiftUI

/// The conversation with a sidebar that slides it aside, like the apps people already know.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @GestureState private var drag: CGFloat = 0

    private let drawerWidth: CGFloat = 316

    var body: some View {
        @Bindable var model = model
        Group {
            if model.startup == .error {
                VStack(spacing: 16) {
                    Text("Couldn’t restore your connection.").foregroundStyle(.secondary)
                    Button("Retry") { model.command("start") }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.startup == .loading || (model.teams.isEmpty && (model.connection == .connecting || model.connection == .reconnecting)) {
                StartupView(productName: model.productName, connecting: !model.laptops.isEmpty)
            } else if model.needsPairing { PairingView() } else { shell }
        }
        .background { EngineView(host: model.engine).frame(width: 1, height: 1).opacity(0.01).allowsHitTesting(false) }
    }

    private var shell: some View {
        @Bindable var model = model
        return GeometryReader { _ in
            let reveal = revealAmount
            ZStack(alignment: .leading) {
                DrawerView()
                    .frame(width: drawerWidth)
                    .offset(x: reveal - drawerWidth)
                    .accessibilityHidden(!model.drawerOpen)

                ConversationScreen()
                    .clipShape(.rect(cornerRadius: reveal > 1 ? 32 : 0, style: .continuous))
                    .shadow(color: .black.opacity(0.12 * Double(reveal / drawerWidth)), radius: 24)
                    .offset(x: reveal)
                    .overlay {
                        if model.drawerOpen {
                            Color.clear.contentShape(Rectangle())
                                .offset(x: reveal)
                                .onTapGesture { setDrawer(false) }
                        }
                    }
            }
            .background(Color(.systemBackground))
            .gesture(
                DragGesture(minimumDistance: 12)
                    .updating($drag) { value, state, _ in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        state = value.translation.width
                    }
                    .onEnded { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        let projected = value.predictedEndTranslation.width
                        if model.drawerOpen { setDrawer(projected > -drawerWidth / 3) }
                        else { setDrawer(projected > drawerWidth / 3) }
                    }
            )
        }
    }

    /// How far the conversation is pushed aside, following the finger while dragging.
    private var revealAmount: CGFloat {
        let base: CGFloat = model.drawerOpen ? drawerWidth : 0
        return min(drawerWidth, max(0, base + drag))
    }

    private func setDrawer(_ open: Bool) {
        withAnimation(.smooth(duration: 0.32)) { model.drawerOpen = open }
    }
}
