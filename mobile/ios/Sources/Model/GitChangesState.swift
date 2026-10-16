import Foundation

struct GitChangesState: Decodable, Equatable {
    struct Summary: Decodable, Equatable {
        let changedFiles: Int
        let addedLines: Int
        let removedLines: Int
    }
    struct Uncommitted: Decodable, Equatable {
        let state: String
        let changedFiles: Int
        let addedLines: Int
        let removedLines: Int
    }
    struct Choice: Decodable, Equatable, Identifiable {
        let id: String
        let label: String
        let detail: String?
        let summary: Summary
    }
    var available = false
    var uncommitted: Uncommitted? = nil
    var status = "idle"
    var scopeId = "uncommitted"
    var choices: [Choice] = []
    var summary: Summary? = nil

    var selectedChoice: Choice? { choices.first { $0.id == scopeId } }
}
