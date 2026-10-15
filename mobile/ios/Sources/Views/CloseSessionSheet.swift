import SwiftUI

struct CloseSessionSheet: View {
    @Environment(AppModel.self) private var model
    let preview: EngineState.ClosePreview
    @State private var discardChanges = false
    @State private var deleteRemoteBranch = false
    @State private var deletingWorktree = false

    private var busy: Bool { model.sessionAction != nil }

    var body: some View {
        NavigationStack {
            Group {
                if busy {
                    AppSheetProgress(title: deletingWorktree ? "Deleting worktree" : "Closing session",
                                     symbol: deletingWorktree ? "folder.badge.minus" : "checkmark.bubble",
                                     message: deletingWorktree ? "\(model.productName) is removing the worktree and closing the session." : "\(model.productName) is closing the session.",
                                     branch: preview.branch)
                } else { confirmation }
            }
            .navigationTitle(busy ? "" : "Close Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !busy {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { model.cancelCloseSession() }
                    }
                }
            }
        }
        .appSheetSurface()
        .interactiveDismissDisabled(busy)
        .presentationDetents(busy ? [.medium] : [.medium, .large])
        .presentationDragIndicator(busy ? .hidden : .visible)
    }

    private var confirmation: some View {
        AppSheetList {
            Section {
                Text("This session uses the linked worktree **\(preview.branch ?? "(detached)")**.")
                Text("Deleting the worktree also deletes its local branch. Keeping it leaves your files in place.")
                    .foregroundStyle(.secondary)
            }
            if preview.hasChanges || preview.upstream != nil {
                Section {
                    if preview.hasChanges {
                        Toggle("Discard uncommitted changes", isOn: $discardChanges)
                    }
                    if let upstream = preview.upstream {
                        Toggle("Also delete \(upstream)", isOn: $deleteRemoteBranch)
                    }
                }
            }
            Section {
                Button("Keep Worktree and Close") {
                    deletingWorktree = false
                    model.confirmCloseSession(preview.id, deleteWorktree: false)
                }
                Button("Delete Worktree and Close", role: .destructive) {
                    deletingWorktree = true
                    model.confirmCloseSession(preview.id, deleteWorktree: true, deleteRemoteBranch: deleteRemoteBranch, discardChanges: discardChanges)
                }
                .disabled(preview.hasChanges && !discardChanges)
            }
            if model.sessionActionFailed {
                Text("The session couldn’t be closed. Check the connection and worktree status, then try again.")
                    .foregroundStyle(.red)
            }
        }
    }
}
