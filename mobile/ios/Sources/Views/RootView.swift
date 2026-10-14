import SwiftUI

/// The conversation with a sidebar that slides it aside, like the apps people already know.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var drag: CGFloat = 0
    @GestureState private var isDragging = false

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
        .overlay(alignment: .top) {
            if let notification = model.notifications.current {
                NotificationBanner(notification: notification, open: { model.open(notification) }, dismiss: { model.notifications.dismiss(id: notification.id) })
                    .id(notification.id)
            }
        }
        .animation(.smooth(duration: 0.25), value: model.notifications.current?.id)
        .alert("Notifications", isPresented: Binding(get: { model.notificationError != nil || model.push.error != nil }, set: { if !$0 { model.notificationError = nil; model.push.error = nil } })) {
            Button("OK") { model.notificationError = nil; model.push.error = nil }
        } message: { Text(model.notificationError ?? model.push.error ?? "") }
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
                    .mask {
                        // Navigation chrome extends beyond the safe-area layout bounds.
                        RoundedRectangle(cornerRadius: reveal > 1 ? 32 : 0, style: .continuous)
                            .ignoresSafeArea()
                    }
                    .shadow(color: .black.opacity(0.12 * Double(reveal / drawerWidth)), radius: 24)
                    .overlay(alignment: .leading) {
                        // Capture the screen edge above the web view's scroll recognizers.
                        // Once open, the displaced conversation is also the dismissal surface.
                        Color.clear
                            .frame(width: model.drawerOpen ? nil : 24)
                            .contentShape(Rectangle())
                            .onTapGesture { if model.drawerOpen { setDrawer(false) } }
                            .gesture(drawerGesture)
                            .allowsHitTesting(!model.reviewOpen)
                    }
                    .offset(x: reveal)
            }
            .background(Color(.systemBackground))
            .onChange(of: isDragging) { _, active in
                // A cancelled gesture has no onEnded callback.
                if !active && drag != 0 { setDrawer(model.drawerOpen) }
            }
        }
    }

    private var drawerGesture: some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .global)
            .updating($isDragging) { _, active, _ in active = true }
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                drag = value.translation.width
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    setDrawer(model.drawerOpen)
                    return
                }
                let projected = value.predictedEndTranslation.width
                if model.drawerOpen { setDrawer(projected > -drawerWidth / 3) }
                else { setDrawer(projected > drawerWidth / 3) }
            }
    }

    /// How far the conversation is pushed aside, following the finger while dragging.
    private var revealAmount: CGFloat {
        let base: CGFloat = model.drawerOpen ? drawerWidth : 0
        return min(drawerWidth, max(0, base + drag))
    }

    private func setDrawer(_ open: Bool) {
        // Commit both values together so settling begins at the finger's current offset.
        withAnimation(.smooth(duration: open ? 0.32 : 0.2)) {
            model.drawerOpen = open
            drag = 0
        }
    }
}
