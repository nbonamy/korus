import SwiftUI

struct ExistingBranchSheet: View {
    @Environment(AppModel.self) private var model
    let group: SidebarGroup
    @State private var query = ""
    @State private var selectedBranch: String?

    private var busy: Bool { model.chatCreation == .creating }
    private var branches: RepositoryBranches {
        model.branches.repositoryId == group.repositoryId ? model.branches : RepositoryBranches()
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.connection != .connected {
                    ContentUnavailableView("Not connected", systemImage: "wifi.slash", description: Text("Reconnect to your laptop to browse branches."))
                } else if branches.status == .loading {
                    ProgressView("Loading branches…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if branches.status == .failed || branches.status == .idle {
                    VStack(spacing: 16) {
                        Text("Couldn’t load branches.").foregroundStyle(.secondary)
                        Button("Retry") { model.loadBranches(in: group) }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    branchList
                }
            }
            .navigationTitle("Existing Branch")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search branches")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.closeBranchSheet() }.disabled(busy)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.chatCreation == .failed {
                    VStack(spacing: 8) {
                        Text("Couldn’t start the chat. Refresh the branches and try again.")
                            .font(.footnote).foregroundStyle(.red)
                        Button("Refresh branches") { model.loadBranches(in: group) }
                    }
                    .padding().frame(maxWidth: .infinity).background(.regularMaterial)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(busy)
        .onAppear { model.loadBranches(in: group) }
        .onChange(of: model.connection) { _, connection in
            if connection == .connected { model.loadBranches(in: group) }
        }
    }

    private var branchList: some View {
        List {
            Section(group.label) {
                ForEach(branches.matching(query)) { branch in
                    Button {
                        selectedBranch = branch.name
                        model.startChat(in: group, existingBranch: branch.name)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "arrow.triangle.branch").foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(branch.name).foregroundStyle(.primary)
                                if branch.isDefault { Text("Default").font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 8)
                            if busy && selectedBranch == branch.name { ProgressView() }
                            else if branch.isCheckedOut { Text("Checked out").font(.caption).foregroundStyle(.secondary) }
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                    }
                    .disabled(busy || !model.canStartChat)
                }
            }
        }
        .overlay {
            if branches.items.isEmpty {
                ContentUnavailableView("No branches", systemImage: "arrow.triangle.branch")
            } else if branches.matching(query).isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
    }
}
