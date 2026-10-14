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
                    .disabled(busy)
                    .onChange(of: branchName) { _, name in
                        if name.contains(" ") { branchName = name.replacingOccurrences(of: " ", with: "-") }
                    }
            }
            .padding(.horizontal, 16).frame(height: 50)
            .glassEffect(.regular, in: .capsule)
            if model.chatCreation == .failed {
                Text("Couldn’t create the worktree. Check the branch name and the connection.")
                    .font(.footnote).foregroundStyle(.red)
            } else {
                Text("Created from the default branch of \(group.label).")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Button(action: start) {
                Group {
                    if busy { HStack(spacing: 8) { ProgressView(); Text("Setting up…") } } else { Text("Create") }
                }
                .font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 50)
            }
            .buttonStyle(.glassProminent)
            .disabled(trimmed.isEmpty || busy)
        }
        .padding(20)
        .presentationDetents([.height(290)])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(busy)
        .onAppear { focused = true }
    }

    private func start() {
        guard !trimmed.isEmpty else { return }
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
