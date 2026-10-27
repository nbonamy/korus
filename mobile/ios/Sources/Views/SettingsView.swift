import SwiftUI

/// The settings of the app: the laptop it talks to, how it behaves, and what it is.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @State private var forgetting: EngineState.Laptop?

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    private var currentLaptop: EngineState.Laptop? { model.laptops.first { $0.id == model.laptopID } }

    var body: some View {
        NavigationStack {
            AppSheetList {
                header

                Section {
                    NavigationLink { ConnectionsView(closeSettings: { dismiss() }) } label: {
                        plainLabel("Connections", systemImage: "laptopcomputer")
                    }
                    NavigationLink { UsageView() } label: {
                        plainLabel("Usage and limits", systemImage: "gauge.with.dots.needle.33percent")
                    }
                } header: { sectionTitle("Account") }

                Section {
                    NavigationLink { FollowUpSettingsView() } label: {
                        row("Follow-up", systemImage: "bubble.left", value: model.composerPreferences.followUpBehavior.label)
                    }
                    Button { Task { await model.push.enable() } } label: {
                        row("Notifications", systemImage: "bell", value: model.push.standing.label, chevron: true)
                    }
                    .tint(.primary)
                    if model.pushRegistrationFailed {
                        Button("Retry notification setup", systemImage: "arrow.clockwise") { Task { await model.push.refresh() } }
                    }
                    Toggle(isOn: Binding(get: { lock.isEnabled }, set: { on in Task { await lock.setEnabled(on) } })) {
                        plainLabel("Lock with Face ID", systemImage: "faceid")
                    }
                    .disabled(!lock.canProtect || lock.isAuthenticating)
                } header: { sectionTitle("Preferences") } footer: {
                    if !lock.canProtect { Text("Set a passcode on this iPhone to lock the app.") }
                }

                Section {
                    if let url = model.privacyPolicyURL {
                        Link(destination: url) { plainLabel("Privacy Policy", systemImage: "hand.raised") }.tint(.primary)
                    }
                    row("Version", systemImage: "info.circle", value: version)
                } header: { sectionTitle("About") }

                if let laptop = currentLaptop {
                    Section {
                        Button(role: .destructive) { forgetting = laptop } label: {
                            Label("Forget this laptop", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() } }
            }
            .forgetLaptopConfirmation($forgetting) { laptop in
                model.command("forget", ["laptopId": laptop.id])
                dismiss()
            }
        }
        .appSheetSurface()
    }

    private var header: some View {
        Section {
            VStack(spacing: 10) {
                BrandMark(size: 72)
                Text(model.productName).font(.title2.weight(.semibold))
                if let line = model.connection.summary(laptop: currentLaptop?.name, lost: model.showConnectionLost) {
                    Text(line).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
        .listRowBackground(Color.clear)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).textCase(nil)
    }

    private func row(_ title: String, systemImage: String, value: String, chevron: Bool = false) -> some View {
        LabeledContent {
            HStack(spacing: 6) {
                Text(value)
                if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
            }
        } label: {
            plainLabel(title, systemImage: systemImage)
        }
    }

    /// Settings rows read as a quiet list: the icons are the text's color, not the app's accent.
    private func plainLabel(_ title: String, systemImage: String) -> some View {
        Label { Text(title) } icon: { Image(systemName: systemImage).foregroundStyle(.primary) }
    }
}

/// How a message sent while the agent is still working is handled; the explanation lives here, not on the list.
private struct FollowUpSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        AppSheetList {
            Section {
                Picker("Follow-up", selection: Binding(get: { model.composerPreferences.followUpBehavior }, set: { model.composerPreferences.followUpBehavior = $0 })) {
                    ForEach(ComposerSendMode.allCases, id: \.self) { mode in Text(mode.label).tag(mode) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } footer: {
                Text("Steer changes what the agent is doing right now. Queue waits for it to finish. Hold Send to choose the other one for a single message.")
            }
        }
        .navigationTitle("Follow-up")
        .navigationBarTitleDisplayMode(.inline)
    }
}
