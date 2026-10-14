import SwiftUI

struct CloseSessionSheet: View {
    @Environment(AppModel.self) private var model
    let preview: EngineState.ClosePreview
    @State private var discardChanges = false
    @State private var deleteRemoteBranch = false

    private var busy: Bool { model.sessionAction != nil }

    var body: some View {
        NavigationStack {
            Form {
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
                    .disabled(busy)
                }
                Section {
                    Button("Keep Worktree and Close") {
                        model.confirmCloseSession(preview.id, deleteWorktree: false)
                    }
                    .disabled(busy)
                    Button("Delete Worktree and Close", role: .destructive) {
                        model.confirmCloseSession(preview.id, deleteWorktree: true, deleteRemoteBranch: deleteRemoteBranch, discardChanges: discardChanges)
                    }
                    .disabled(busy || (preview.hasChanges && !discardChanges))
                }
                if busy { ProgressView("Closing session…") }
                if model.sessionActionFailed {
                    Text("The session couldn’t be closed. Check the connection and worktree status, then try again.")
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle("Close Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancelCloseSession() }.disabled(busy)
                }
            }
        }
        .interactiveDismissDisabled(busy)
        .presentationDetents([.medium, .large])
    }
}
