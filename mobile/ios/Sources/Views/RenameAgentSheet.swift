import SwiftUI

struct RenameAgentSheet: View {
    @State var name: String
    let enabled: Bool
    let cancel: () -> Void
    let save: (String) -> Void
    @FocusState private var focused: Bool
    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            AppSheetList {
                TextField("Agent name", text: $name)
                    .accessibilityLabel("Agent name")
                    .textInputAutocapitalization(.sentences)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { if canSave { save(trimmed) } }
            }
            .navigationTitle("Rename Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save(trimmed) }.disabled(!canSave) }
            }
        }
        .appSheetSurface()
        .presentationDetents([.height(220)])
        .task { focused = true }
    }
    private var canSave: Bool { enabled && !trimmed.isEmpty && trimmed.utf16.count <= 200 }
}
