import SwiftUI

struct ChangesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scopePicker
                    .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
                ZStack {
                    ChangesWebView(host: model.changesHost)
                        .opacity(model.git.status == "loaded" ? 1 : 0)
                    if model.git.status == "failed" {
                        ContentUnavailableView {
                            Label("Couldn’t load changes", systemImage: "doc.text.magnifyingglass")
                        } description: { Text("Check the connection and try again.") }
                        actions: { Button("Retry") { model.loadChanges() }.disabled(model.connection != .connected) }
                    } else if model.git.status != "loaded" {
                        ProgressView("Loading changes…")
                    }
                }
            }
            .appSheetSurface()
            .navigationTitle("Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly).buttonBorderShape(.circle)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh", systemImage: "arrow.clockwise") { model.loadChanges() }
                        .labelStyle(.iconOnly)
                        .disabled(model.connection != .connected || model.git.status == "loading")
                }
            }
        }
        .task { model.loadChanges() }
        .onChange(of: model.connection) { _, connection in
            if connection == .connected { model.loadChanges() }
        }
    }

    private var scopePicker: some View {
        Menu {
            ForEach(model.git.choices.filter { !$0.id.hasPrefix("commit:") }) { choice in choiceButton(choice) }
            let commits = model.git.choices.filter { $0.id.hasPrefix("commit:") }
            if !commits.isEmpty {
                Menu("Commits", systemImage: "clock.arrow.circlepath") {
                    ForEach(commits) { choice in choiceButton(choice) }
                }
            }
        } label: {
            HStack(spacing: 10) {
                Text(model.git.selectedChoice?.label ?? "Uncommitted changes")
                    .font(.body).foregroundStyle(.primary).lineLimit(1)
                Spacer(minLength: 0)
                if let summary = model.git.summary {
                    HStack(spacing: 6) {
                        Text("+\(summary.addedLines)").foregroundStyle(.green)
                        Text("−\(summary.removedLines)").foregroundStyle(.red)
                    }
                    .font(.subheadline.monospacedDigit())
                    .fixedSize()
                }
                Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Change scope")
        .disabled(model.connection != .connected)
    }

    private func choiceButton(_ choice: GitChangesState.Choice) -> some View {
        Button { model.loadChanges(choice.id) } label: {
            if choice.id == model.git.scopeId { Label(choice.label, systemImage: "checkmark") }
            else { Text(choice.detail.map { "\(choice.label) · \($0)" } ?? choice.label) }
        }
    }
}
