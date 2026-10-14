import Foundation

struct ReviewState: Decodable, Equatable {
    enum Status: String, Decodable { case idle, loading, ready, failed, starting, started, unknown }
    var status: Status = .idle
    var setup: ReviewSetup?
}

struct ReviewSetup: Decodable, Equatable {
    struct Model: Decodable, Equatable, Identifiable { let id: String; let name: String; let efforts: [String] }
    struct Preferences: Decodable, Equatable {
        struct Selection: Decodable, Equatable { let model: String?; let reasoningEffort: String? }
        let providers: [String: Selection]
    }
    let target: ComposerTarget
    let branch: String?
    let baseRef: String?
    let uncommitted: Bool
    let branchChanges: Bool
    let currentThread: Bool
    let activeReview: Bool
    var reviewerAgentId: String? = nil
    let agentBackend: String
    let backend: String
    let backends: [String]
    let models: [Model]
    let preferences: Preferences?
}

/// Form choices become the existing app-owned review input only on Start Review.
struct ReviewChoices {
    struct Input: Encodable {
        struct Scope: Encodable { let type: String; let baseRef: String? }
        struct Automation: Encodable { let enabled: Bool; let maxPriority: String; let maxRounds: Int; let autoCommit: Bool }
        let scope: Scope
        let threadMode: String
        let backend: String?
        let model: String?
        let reasoningEffort: String?
        let instructions: String?
        let automation: Automation
    }
    var scope = "uncommitted"
    var thread = "independent"
    var backend = ""
    var model = ""
    var effort = ""
    var instructions = ""
    var automatic = false
    var priority = "p2"
    var rounds = 3
    var autoCommit = false

    mutating func load(_ setup: ReviewSetup, initial: Bool) {
        if initial { scope = setup.uncommitted ? "uncommitted" : "branch" }
        if initial || backend != setup.backend { backend = setup.backend }
        let saved = setup.preferences?.providers[backend]
        model = setup.models.first(where: { $0.id == saved?.model })?.id ?? ""
        effort = setup.models.first(where: { $0.id == model })?.efforts.first(where: { $0 == saved?.reasoningEffort }) ?? ""
    }

    func input(_ setup: ReviewSetup) -> Input? {
        guard !setup.activeReview, setup.backend == backend,
              scope == "uncommitted" ? setup.uncommitted : (setup.branchChanges && setup.baseRef != nil),
              thread != "current" || (setup.currentThread && !automatic),
              setup.backends.contains(thread == "current" ? setup.agentBackend : backend) else { return nil }
        let independent = thread == "independent"
        let selected = setup.models.first { $0.id == model }
        let text = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        return Input(scope: .init(type: scope, baseRef: scope == "branch" ? setup.baseRef : nil), threadMode: thread,
                     backend: independent ? backend : nil, model: independent ? selected?.id : nil,
                     reasoningEffort: independent && selected?.efforts.contains(effort) == true ? effort : nil,
                     instructions: text.isEmpty ? nil : text,
                     automation: .init(enabled: automatic, maxPriority: priority, maxRounds: min(10, max(1, rounds)), autoCommit: automatic && autoCommit))
    }
}
