import SwiftUI

/// Names the branch of a new worktree. Everything else about a new chat is decided from the repository's menu.
struct NewWorktreeSheet: View {
    @Environment(AppModel.self) private var model
    let group: SidebarGroup
    @State private var branchName = ""
    @FocusState private var focused: Bool

    private var busy: Bool { model.chatCreation == .creating }
    private var trimmed: String { branchName.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        Group {
            if busy {
                AppSheetProgress(title: "Creating your worktree", symbol: "arrow.triangle.branch",
                                 message: "\(model.productName) is getting the workspace ready.", subject: group.label, branch: trimmed)
            } else { form.padding(20) }
        }
        .appSheetSurface()
        .presentationDetents(busy ? [.medium] : [.height(290)])
        .presentationDragIndicator(busy ? .hidden : .visible)
        .interactiveDismissDisabled(busy)
        .onAppear { focused = !busy }
        .onChange(of: busy) { _, busy in if busy { focused = false } }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New worktree").font(.headline)
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.branch").foregroundStyle(.secondary)
                TextField("Branch name", text: $branchName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(start)
                    .onChange(of: branchName) { _, name in
                        if name.contains(" ") { branchName = name.replacingOccurrences(of: " ", with: "-") }
                    }
            }
            .padding(.horizontal, 16).frame(height: 50)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
            if model.chatCreation == .failed {
                Text("Couldn’t create the worktree. Check the branch name and the connection.")
                    .font(.footnote).foregroundStyle(.red)
            } else {
                Text("Created from the default branch of \(group.label).")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Button(action: start) {
                Text("Create")
                    .font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 50)
            }
            .buttonStyle(.glassProminent)
            .disabled(trimmed.isEmpty)
        }
    }

    private func start() {
        guard !trimmed.isEmpty else { return }
        focused = false
        model.startChat(in: group, branchName: trimmed)
    }
}

extension String {
    /// How an engine id reads in the interface.
    var engineName: String {
        switch self {
        case "codex": "Codex"
        case "claude": "Claude"
        case "antigravity": "Antigravity"
        default: capitalized
        }
    }
}
