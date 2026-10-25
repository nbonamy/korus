import SwiftUI

// The native view is real. Only its engine-facing model is replaced so catalog
// responses and deferred branch loading are deterministic, without pairing.
enum EngineState {
    struct Laptop { let id: String; let name: String }
    enum ChatCreation { case idle, creating, failed }
    struct ProjectRepositories {
        struct Repository: Identifiable { let id: String; let name: String }
        var status = "idle"
        var items: [Repository] = []
    }
    struct ProjectBranches {
        struct Branch: Identifiable { let name: String; let isDefault: Bool; var id: String { name } }
        var repositoryId: String?
        var status = "idle"
        var items: [Branch] = []
    }
}

@Observable @MainActor final class AppModel {
    enum Connection { case connected, disconnected }
    var connection = Connection.connected
    var chatCreation = EngineState.ChatCreation.idle
    var projectRepositories = EngineState.ProjectRepositories()
    var projectBranches = EngineState.ProjectBranches()
    var newProjectSource: NewProjectSource?
    var selection = ""
    var laptopID = "first-host"
    let newChatBackend: String? = "codex"
    let productName = "Korus"
    var canStartChat: Bool { true }
    func dismissChatFailure() { chatCreation = .idle }
    func closeProjectSheet() { newProjectSource = nil }
    func reconnect() {}
    private var catalogAttempts = 0
    private var branchAttempts = 0
    private var createAttempts = 0
    private var catalogGeneration = 0
    private var scenario: String { ProcessInfo.processInfo.arguments.last ?? "" }
    func command(_ type: String, _ fields: [String: Any] = [:]) {
        if type == "loadProjectRepositories" {
            catalogGeneration += 1
            catalogAttempts += 1
            if fields["source"] as? String == "gitlab" {
                projectBranches = .init()
                if scenario == "--access-retry" && catalogAttempts == 1 {
                    projectRepositories = .init(status: "failed")
                } else if scenario == "--empty" { projectRepositories = .init(status: "loaded") }
                else { projectRepositories = .init(status: "loaded", items: [.init(id: laptopID == "first-host" ? "gitlab:opaque" : "gitlab:second", name: laptopID == "first-host" ? "group/subgroup/korus" : "remote/group/korus")]) }
                return
            }
            projectRepositories.status = "loaded"
            projectRepositories.items = (0..<80).map { .init(id: "repo-\($0)", name: "Project \($0)") }
            projectRepositories.items.insert(.init(id: "korus-id", name: "korus"), at: 25)
            projectRepositories.items.insert(.init(id: "media-id", name: "mediastation"), at: 36)
        } else if type == "loadProjectBranches", let id = fields["repositoryId"] as? String {
            branchAttempts += 1
            let generation = catalogGeneration
            projectBranches = .init(repositoryId: id, status: "loading")
            if scenario == "--branch-retry" && branchAttempts == 1 { projectBranches.status = "failed"; return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(200))
                guard projectBranches.repositoryId == id, catalogGeneration == generation else { return }
                let names = id.hasPrefix("gitlab:") ? ["develop", "feature/ios"] : id == "korus-id" ? ["main", "badges", "feat/pull-request-status", "feat/repository-run-profiles", "research/harness-cost", "research/pstack-integration"] : ["master", "pure_audio", "thread"]
                projectBranches = .init(repositoryId: id, status: "loaded", items: names.enumerated().map { .init(name: $0.element, isDefault: $0.offset == 0) })
            }
        } else if type == "dismissProjectBranches" { projectBranches = .init() }
        else if type == "dismissProjectRepositories" { catalogGeneration += 1; projectRepositories = .init(); projectBranches = .init() }
    }
    func createProject(source: NewProjectSource, value: String, backend: String, branch: String? = nil, worktree: [String: String]? = nil) {
        createAttempts += 1
        if scenario == "--clone-retry" && createAttempts == 1 { chatCreation = .failed; return }
        if source.rawValue == "gitlab" {
            selection = "Selected gitlab \(value):\(branch ?? worktree?["branchName"] ?? "") base:\(worktree?["baseBranch"] ?? "")"
        } else { selection = "Selected \(value):\(branch ?? "")" }
        newProjectSource = nil
    }
}

@main struct ProjectPickerFixture: App {
    @State private var model = AppModel()
    @State private var showingRename = false
    @State private var name = "Original"
    @State private var forgetting: EngineState.Laptop?
    @State private var forgotten = false
    var body: some Scene {
        WindowGroup {
            @Bindable var model = model
            VStack {
                Button("Existing Project") { model.newProjectSource = .existing }
                NewAgentMenu(enabled: true, quickChat: {}, select: { model.newProjectSource = $0 })
                Text(model.selection)
                Button("Rename Agent") { showingRename = true }
                Text("Agent: \(name)")
                Button("Forget this laptop") { forgetting = .init(id: "laptop", name: "Work laptop") }
                Text(forgotten ? "Laptop forgotten" : "Laptop retained")
            }
            .forgetLaptopConfirmation($forgetting) { _ in forgotten = true }
            .sheet(item: $model.newProjectSource) { source in
                NewProjectSheet(source: source).environment(model)
                    .overlay(alignment: .bottomTrailing) {
                        if ProcessInfo.processInfo.arguments.contains("--host-switch") {
                            Button("Switch Host") { model.laptopID = "second-host" }.padding()
                        }
                    }
            }
            .sheet(isPresented: $showingRename) {
                RenameAgentSheet(name: name, enabled: true, cancel: { showingRename = false }) {
                    name = $0; showingRename = false
                }
            }
        }
    }
}
