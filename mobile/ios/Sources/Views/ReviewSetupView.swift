import SwiftUI

/// A navigation destination keeps setup in the conversation's Back stack.
struct ReviewSetupView: View {
    @Environment(AppModel.self) private var app
    @State private var choices = ReviewChoices()
    @State private var loaded = false
    @State private var loadedBackend = ""

    private var busy: Bool { app.reviewState.status == .loading || app.reviewState.status == .starting }

    var body: some View {
        Group {
            if app.reviewState.status == .starting {
                AppSheetProgress(title: "Starting your review", symbol: "checklist",
                                 message: "\(app.productName) is preparing the reviewer.")
            } else if let setup = app.reviewState.setup {
                if setup.activeReview {
                    ContentUnavailableView {
                        Label("Review already started", systemImage: "checklist")
                    } description: { Text("Open the reviewer’s conversation to follow its progress.") }
                    actions: {
                        if let id = setup.reviewerAgentId {
                            Button("Open Review Conversation") { app.reviewOpen = false; app.select(agent: id) }
                        }
                    }
                } else if !setup.uncommitted && !setup.branchChanges {
                    ContentUnavailableView("Nothing to review", systemImage: "checkmark.circle", description: Text("This workspace has no changes to review."))
                } else { form(setup) }
            } else if app.reviewState.status == .failed || app.connection != .connected {
                ContentUnavailableView {
                    Label("Couldn’t load review setup", systemImage: "wifi.exclamationmark")
                } description: { Text("Check your laptop connection and try again.") }
                actions: { Button("Retry") { app.command("loadReview") } }
            } else { ProgressView("Loading review setup…") }
        }
        .navigationTitle(app.reviewState.status == .starting ? "" : "Review Changes")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(app.reviewState.status == .starting)
        .onChange(of: app.connection) { _, connection in
            if connection == .connected { app.command("loadReview") }
        }
        .onChange(of: app.reviewState, initial: true) { _, state in
            guard state.status == .ready, let setup = state.setup else { return }
            if !loaded || loadedBackend != setup.backend {
                choices.load(setup, initial: !loaded)
                loaded = true; loadedBackend = setup.backend
            }
        }
    }

    private func form(_ setup: ReviewSetup) -> some View {
        AppSheetList {
            Section {
                choice("Uncommitted Changes", description: setup.uncommitted ? "Staged and unstaged changes in this workspace." : "No uncommitted changes.",
                       icon: "doc.badge.ellipsis", selected: choices.scope == "uncommitted", enabled: setup.uncommitted) { choices.scope = "uncommitted" }
                choice("Current Branch", description: setup.branchChanges ? "\(setup.branch ?? "Current branch") compared with \(setup.baseRef ?? "base branch")." : "No branch changes available.",
                       icon: "arrow.triangle.branch", selected: choices.scope == "branch", enabled: setup.branchChanges) { choices.scope = "branch" }
            } header: { Text("Scope") }
            Section {
                choice("Independent Reviewer", description: "A separate agent reviews your changes with fresh context.", icon: "person.crop.circle",
                       selected: choices.thread == "independent", enabled: true) { choices.thread = "independent" }
                choice("Current Conversation", description: choices.automatic ? "Automatic review requires an independent reviewer." : "Review with the context of this conversation.", icon: "bubble.left",
                       selected: choices.thread == "current", enabled: setup.currentThread && !choices.automatic) { choices.thread = "current" }
            } header: { Text("Reviewer") }
            if choices.thread == "independent" {
                Section {
                    Picker("Engine", selection: $choices.backend) {
                        ForEach(setup.backends, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .onChange(of: choices.backend) { _, backend in
                        if backend != setup.backend { app.command("loadReview", ["backend": backend]) }
                    }
                    Picker("Model", selection: $choices.model) {
                        Text(setup.backend == setup.agentBackend ? "Current Model" : "Default Model").tag("")
                        ForEach(setup.models) { Text($0.name).tag($0.id) }
                    }
                    .onChange(of: choices.model) { _, _ in
                        if !efforts(setup).contains(choices.effort) { choices.effort = "" }
                    }
                    if !efforts(setup).isEmpty {
                        Picker("Reasoning", selection: $choices.effort) {
                            Text("Default").tag("")
                            ForEach(efforts(setup), id: \.self) { Text($0.capitalized).tag($0) }
                        }
                    }
                } header: { Text("Model") }
            }
            Section {
                TextField("What should the reviewer focus on?", text: $choices.instructions, axis: .vertical)
                    .lineLimit(3...6)
            } header: { Text("Additional Instructions") }
            Section {
                Toggle("Automatic Review", isOn: $choices.automatic)
                    .onChange(of: choices.automatic) { _, enabled in if enabled { choices.thread = "independent" } }
                if choices.automatic {
                    Picker("Fix Findings", selection: $choices.priority) {
                        Text("Critical (P0)").tag("p0")
                        Text("High and above (P1)").tag("p1")
                        Text("Medium and above (P2)").tag("p2")
                        Text("All priorities (P3)").tag("p3")
                    }
                    Stepper("Maximum Rounds: \(choices.rounds)", value: $choices.rounds, in: 1...10)
                    Toggle("Commit Fixes Automatically", isOn: $choices.autoCommit)
                }
            } footer: {
                Text(choices.automatic ? "The reviewer fixes selected priorities and reviews again, up to the round limit." : "Review findings before deciding which fixes to make.")
            }
            if app.reviewState.status == .unknown || app.reviewState.status == .failed {
                Section {
                    Text(app.reviewState.status == .unknown ? "Couldn’t confirm whether the review started. Refresh its status before trying again." : "Couldn’t load reviewer models. Check your connection and retry.")
                        .foregroundStyle(.secondary)
                    Button("Refresh") { app.command("loadReview", ["backend": choices.backend]) }
                }
            }
        }
        .disabled(busy)
        .safeAreaInset(edge: .bottom) {
            Button { app.startReview(choices) } label: {
                Text("Start Review").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .disabled(app.reviewState.status != .ready || !app.canSend || choices.input(setup) == nil)
            .appSheetFooter()
        }
    }

    private func efforts(_ setup: ReviewSetup) -> [String] { setup.models.first { $0.id == choices.model }?.efforts ?? [] }

    private func choice(_ title: String, description: String, icon: String, selected: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon).frame(width: 24).padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.body.weight(.medium))
                    Text(description).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle").foregroundStyle(selected ? Color.accentColor : .secondary)
            }.padding(.vertical, 4).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!enabled).opacity(enabled ? 1 : 0.45)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
