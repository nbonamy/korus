import Foundation

/// App-owned request data. No provider protocol or transcript parsing in the native shell.
struct PendingRequest: Decodable, Identifiable {
    struct Target: Codable {
        let hostId: String
        let locationId: String
        let teamId: String
        let agentId: String
        let sessionId: String?
    }
    struct Request: Decodable {
        let id: String
        let conversationId: String
        let kind: String
        let question: QuestionGroup?
        let approval: Approval?
        let confirmation: Confirmation?
    }
    struct QuestionGroup: Decodable { let questions: [Question]; let blocking: Bool }
    struct Question: Decodable, Identifiable {
        struct Option: Decodable { let label: String; let description: String }
        let id: String
        let header: String
        let question: String
        let isSecret: Bool
        let multiSelect: Bool?
        let options: [Option]?
    }
    struct Approval: Decodable {
        struct Permission: Decodable {
            let kind: String
            let access: String?
            let path: String?
            let enabled: Bool?
            let host: String?
            let `protocol`: String?
        }
        let title: String
        let description: String?
        let command: String?
        let cwd: String?
        let allowedScopes: [String]?
        let canDeny: Bool?
        let requestedPermissions: [Permission]?
    }
    struct Confirmation: Decodable {
        let integrationName: String
        let toolName: String
        let summary: String
        let argumentsPreview: String
        let allowConversation: Bool?
        let allowAlways: Bool?
    }
    let key: String
    let target: Target
    let request: Request
    var id: String { key }
    var title: String { request.kind == "question" ? "Your input is needed" : "Approval needed" }

    func reply(outcome: [String: Any]) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(target),
              var targetJSON = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        targetJSON["sessionId"] = target.sessionId as Any? ?? NSNull()
        return ["target": targetJSON, "id": request.id, "conversationId": request.conversationId, "outcome": outcome]
    }
}

struct RequestDraft {
    var selections: [String: Set<String>] = [:]
    var text: [String: String] = [:]

    mutating func toggle(_ option: String, for question: PendingRequest.Question) {
        var selected = selections[question.id] ?? []
        if selected.contains(option) { selected.remove(option) }
        else if question.multiSelect == true { selected.insert(option) }
        else { selected = [option] }
        selections[question.id] = selected
    }

    func answers(for questions: [PendingRequest.Question]) -> [String: [String: [String]]]? {
        var answers: [String: [String: [String]]] = [:]
        for question in questions {
            let freeform = (text[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let selected = (question.options ?? []).map(\.label).filter { selections[question.id]?.contains($0) == true }
            // A custom single-choice answer replaces the selected suggestion; multi-select can combine both.
            let values = !freeform.isEmpty ? (question.multiSelect == true ? selected + [freeform] : [freeform]) : selected
            guard !values.isEmpty else { return nil }
            answers[question.id] = ["answers": values]
        }
        return answers
    }
}
