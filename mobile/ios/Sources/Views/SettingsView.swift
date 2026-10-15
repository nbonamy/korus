import SwiftUI

/// The few settings the app has: what protects it, what reaches the person, and the link to the laptop.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingForget = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            AppSheetList {
                Section {
                    NavigationLink { UsageView() } label: {
                        Label("Usage", systemImage: "gauge.with.dots.needle.33percent")
                    }
                }

                Section {
                    Toggle(isOn: Binding(get: { lock.isEnabled }, set: { on in Task { await lock.setEnabled(on) } })) {
                        Label("Lock with Face ID", systemImage: "faceid")
                    }
                    .disabled(!lock.canProtect || lock.isAuthenticating)
                } header: {
                    Text("Security")
                } footer: {
                    Text(lock.canProtect
                         ? "Ask for Face ID, Touch ID or your passcode when the app opens and after five minutes away."
                         : "Set a passcode on this iPhone to lock the app.")
                }

                Section {
                    Button { Task { await model.push.enable() } } label: {
                        LabeledContent { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) } label: {
                            Label(model.push.status, systemImage: "bell.badge")
                        }
                    }
                    .tint(.primary)
                    if model.pushRegistrationFailed {
                        Button("Retry notification setup", systemImage: "arrow.clockwise") { Task { await model.push.refresh() } }
                    }
                } header: {
                    Text("Notifications")
                }

                Section {
                    if model.showConnectionLost {
                        ConnectionLostNotice(reconnect: model.reconnect)
                    }
                    Button(role: .destructive) { confirmingForget = true } label: {
                        Label { Text("Forget this laptop") } icon: { Image(systemName: "trash").foregroundStyle(.red) }
                    }
                } header: {
                    Text("Laptop")
                }

                Section {
                    LabeledContent("Version", value: version)
                } header: {
                    Text(model.productName)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Forget this laptop?", isPresented: $confirmingForget, titleVisibility: .visible) {
                Button("Forget Laptop", role: .destructive) { model.forget(); dismiss() }
            } message: {
                Text("You will need a new pairing code to connect again.")
            }
        }
        .appSheetSurface()
    }
}
