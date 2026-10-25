import SwiftUI

enum NewProjectSource: String, Identifiable, CaseIterable {
    case new, existing = "local", github, gitlab, url
    var usesRepositoryPicker: Bool { self == .github || self == .gitlab || self == .existing }
    var id: String { rawValue }
    var title: String {
        switch self { case .new: "New Project"; case .existing: "Existing Project"; case .github: "GitHub Repository"; case .gitlab: "GitLab Repository"; case .url: "Repository URL" }
    }
    var menuTitle: String {
        switch self { case .new: "New Project"; case .existing: "Existing Project"; case .github: "From GitHub"; case .gitlab: "From GitLab"; case .url: "From URL" }
    }
    var symbol: String {
        switch self { case .new: "folder.badge.plus"; case .existing: "folder"; case .github, .gitlab: "chevron.left.forwardslash.chevron.right"; case .url: "link" }
    }
}

struct NewAgentMenu: View {
    let enabled: Bool
    let quickChat: () -> Void
    let select: (NewProjectSource) -> Void

    var body: some View {
        Menu {
            Button("Quick Chat", systemImage: "square.and.pencil", action: quickChat)
            Divider()
            ForEach(NewProjectSource.allCases) { source in
                Button(source.menuTitle, systemImage: source.symbol) { select(source) }
            }
        } label: {
            Label("New Agent", systemImage: "plus")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
        }
        .menuOrder(.fixed)
        .buttonStyle(.glassProminent)
        .tint(.accentColor)
        .disabled(!enabled)
    }
}

struct NewProjectSheet: View {
    @Environment(AppModel.self) private var model
    let source: NewProjectSource
    @State private var value = ""
    @State private var query = ""
    @State private var branchQuery = ""
    @State private var repository: EngineState.ProjectRepositories.Repository?
    @State private var selectedBranch: String?
    @State private var creatingBranch = false
    @State private var branchName = ""
    @State private var baseBranch = ""
    @FocusState private var focused: Bool

    private var busy: Bool { model.chatCreation == .creating }
    private var selectedBackend: String { model.newChatBackend ?? "" }
    private var trimmed: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedBranch: String { branchName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool {
        !trimmed.isEmpty && (source != .new || (trimmed != "." && trimmed != ".." && !trimmed.contains("/") && !trimmed.contains("\\")))
    }
    private var duplicateBranch: Bool { model.projectBranches.items.contains { $0.name == trimmedBranch } }
    private var validBranch: Bool {
        !trimmedBranch.isEmpty && !duplicateBranch && model.projectBranches.items.contains { $0.name == baseBranch }
    }
    private var repositories: [EngineState.ProjectRepositories.Repository] {
        model.projectRepositories.items.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
    }
    private var branches: [EngineState.ProjectBranches.Branch] {
        model.projectBranches.items.filter { branchQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(branchQuery) }
    }
    private var title: String { creatingBranch ? "New Branch" : repository == nil ? source.title : "Choose Branch" }

    var body: some View {
        NavigationStack {
            Group {
                if busy { creationProgress }
                else if model.connection != .connected {
                    ContentUnavailableView {
                        Label("Laptop disconnected", systemImage: "wifi.slash")
                    } description: {
                        Text("Reconnect to your laptop to start a project.")
                    } actions: {
                        Button("Reconnect") { model.reconnect() }
                    }
                } else if source.usesRepositoryPicker && !creatingBranch { repositoryPicker }
                else { projectForm }
            }
            .navigationTitle(busy ? "" : title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !busy {
                    if repository != nil {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(creatingBranch ? "Branches" : "Repositories", systemImage: "chevron.left", action: back)
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Cancel") { model.closeProjectSheet() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !busy && model.connection == .connected && (!source.usesRepositoryPicker || creatingBranch) {
                    Button(action: { creatingBranch ? startBranch() : start(trimmed) }) {
                        Text(creatingBranch ? "Create Branch" : source == .new ? "Create Project" : "Clone Repository")
                            .font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 50)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!(creatingBranch ? validBranch : valid) || !model.canStartChat || selectedBackend.isEmpty)
                    .appSheetFooter()
                }
            }
        }
        .appSheetSurface()
        .presentationDetents(busy ? [.medium] : source.usesRepositoryPicker ? [.large] : [.medium, .large])
        .presentationContentInteraction(.scrolls)
        .presentationDragIndicator(busy ? .hidden : .visible)
        .interactiveDismissDisabled(busy)
        .task(id: source) {
            value = ""
            query = ""
            branchQuery = ""
            repository = nil
            selectedBranch = nil
            creatingBranch = false
            branchName = ""
            baseBranch = ""
            if source.usesRepositoryPicker { model.command("loadProjectRepositories", ["source": source.rawValue]) }
            else { focused = true }
        }
        .task(id: repository?.id) {
            if let repository { model.command("loadProjectBranches", ["repositoryId": repository.id, "source": source.rawValue]) }
        }
        .onChange(of: busy) { _, busy in if busy { focused = false } }
        .onChange(of: model.laptopID) { _, _ in model.closeProjectSheet() }
        .onChange(of: model.connection) { _, connection in
            if connection == .connected && source.usesRepositoryPicker {
                if let repository { model.command("loadProjectBranches", ["repositoryId": repository.id, "source": source.rawValue]) }
                else { model.command("loadProjectRepositories", ["source": source.rawValue]) }
            }
        }
        .onDisappear { model.command("dismissProjectRepositories") }
    }

    /// Only the results scroll; the engine, context and search stay in place.
    private var repositoryPicker: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let repository {
                Text(repository.name).font(.subheadline).foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField(repository == nil ? "Search repositories" : "Search branches", text: repository == nil ? $query : $branchQuery)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focused).submitLabel(.search).onSubmit { focused = false }
                }
                .padding(16)
                Divider()
                ScrollViewReader { scroll in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            Color.clear.frame(height: 0).id("catalog-top")
                            if let repository { branchRows(repository) } else { repositoryRows }
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .scrollBounceBehavior(.basedOnSize)
                    .onChange(of: query) { _, _ in scroll.scrollTo("catalog-top", anchor: .top) }
                    .onChange(of: branchQuery) { _, _ in scroll.scrollTo("catalog-top", anchor: .top) }
                }
                // A repository catalog and its branches have different lazy
                // layouts. Recreate the scroll view instead of retaining the
                // repository list's off-screen content when switching catalogs.
                .id(repository?.id ?? "project-repositories")
            }
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
            .clipShape(.rect(cornerRadius: 16))
            if model.chatCreation == .failed { creationError }
        }
        .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
        .buttonStyle(.plain)
    }

    private var projectForm: some View {
        AppSheetList {
            if creatingBranch {
                Section {
                    TextField("Branch name", text: $branchName)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focused).submitLabel(.go).onSubmit(startBranch)
                    Picker("From", selection: $baseBranch) {
                        ForEach(model.projectBranches.items) { branch in
                            Text(branch.name).tag(branch.name)
                        }
                    }
                } header: {
                    Text(repository?.name ?? "").textCase(nil)
                } footer: {
                    Text(duplicateBranch ? "That branch already exists. Choose it from the branch list or enter a new name." : "Creates a new branch in its own worktree on your laptop.")
                }
            } else {
                Section {
                    TextField(source == .new ? "Project name" : "Repository URL", text: $value)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(source == .url ? .URL : .default)
                        .focused($focused).submitLabel(.go).onSubmit { start(trimmed) }
                } footer: {
                    Text(source == .new ? "Creates a Git repository in your laptop’s source folder." : "Clones the repository to your laptop’s source folder. Use an HTTPS or SSH URL.")
                }
            }
            if model.chatCreation == .failed { creationError }
        }
    }

    private var creationError: some View {
        Text(creatingBranch ? "Couldn’t create this branch. Check the branch name and repository access, then try again." : "Couldn’t open the project. Check repository access and try again.")
            .font(.footnote).foregroundStyle(.secondary)
    }

    private var creationProgress: some View {
        AppSheetProgress(title: creatingBranch ? "Creating your branch" : "Preparing your project",
                         symbol: creatingBranch ? "arrow.triangle.branch" : "folder.badge.gearshape",
                         message: "\(model.productName) is getting the workspace ready.",
                         subject: repository?.name ?? trimmed,
                         branch: creatingBranch ? trimmedBranch : selectedBranch)
    }

    @ViewBuilder private var repositoryRows: some View {
        switch model.projectRepositories.status {
        case "loading": loading("Loading repositories…").padding(16)
        case "loaded":
            ForEach(repositories) { item in
                Button {
                    model.dismissChatFailure()
                    focused = false
                    repository = item
                } label: {
                    Label(item.name, systemImage: "folder")
                        .foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16).contentShape(Rectangle())
                }
                rowDivider
            }
            if repositories.isEmpty {
                Text(query.isEmpty ? "No repositories available." : "No matching repositories.")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
        default:
            Text(source == .existing ? "Couldn’t load repositories. Check the source folder in \(model.productName) on your computer." : "Couldn’t load repositories. Check the \(source == .gitlab ? "GitLab" : "GitHub") connection in \(model.productName) on your computer.")
                .foregroundStyle(.secondary).padding(16)
            Button("Retry") { model.command("loadProjectRepositories", ["source": source.rawValue]) }.padding(16)
        }
    }

    @ViewBuilder private func branchRows(_ repository: EngineState.ProjectRepositories.Repository) -> some View {
        switch model.projectBranches.repositoryId == repository.id ? model.projectBranches.status : "loading" {
        case "loading", "idle": loading("Loading branches…").padding(16)
        case "loaded":
            Button {
                focused = false
                model.dismissChatFailure()
                baseBranch = model.projectBranches.items.first(where: { $0.isDefault })?.name ?? model.projectBranches.items.first?.name ?? ""
                branchName = ""
                creatingBranch = true
            } label: {
                Label("New Branch", systemImage: "plus")
                    .foregroundStyle(.tint)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16).contentShape(Rectangle())
            }
            .disabled(model.projectBranches.items.isEmpty)
            rowDivider
            ForEach(branches) { branch in
                Button {
                    focused = false
                    selectedBranch = branch.name
                    model.createProject(source: source, value: repository.id, backend: selectedBackend, branch: branch.name)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.triangle.branch").foregroundStyle(.secondary)
                        Text(branch.name).foregroundStyle(.primary)
                        Spacer(minLength: 8)
                        if branch.isDefault { Text("Default").font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16).contentShape(Rectangle())
                }
                .disabled(!model.canStartChat || selectedBackend.isEmpty)
                rowDivider
            }
            if branches.isEmpty {
                Text(branchQuery.isEmpty ? "No branches available." : "No matching branches.")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
        default:
            Text("Couldn’t load branches. Check repository access and try again.").foregroundStyle(.secondary).padding(16)
            Button("Retry") { model.command("loadProjectBranches", ["repositoryId": repository.id, "source": source.rawValue]) }.padding(16)
        }
    }

    private var rowDivider: some View { Divider().padding(.leading, 48) }

    private func loading(_ title: String) -> some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text(title).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func back() {
        focused = false
        model.dismissChatFailure()
        if creatingBranch { creatingBranch = false }
        else {
            repository = nil
            branchQuery = ""
            selectedBranch = nil
            model.command("dismissProjectBranches")
        }
    }

    private func startBranch() {
        guard validBranch, let repository else { return }
        focused = false
        model.createProject(source: source, value: repository.id, backend: selectedBackend,
                            worktree: ["branchName": trimmedBranch, "baseBranch": baseBranch])
    }

    private func start(_ input: String) {
        guard valid else { return }
        focused = false
        model.createProject(source: source, value: input, backend: selectedBackend)
    }
}
