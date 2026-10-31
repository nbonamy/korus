import Foundation

struct CodeReviewDetails: Decodable, Equatable {
    let target: ComposerTarget
    let session: Session?
    struct Session: Decodable, Equatable {
        let id: String
        let targetAgentId: String
        let reviewerAgentId: String
        let status: String
        let activeRoundId: String
        let updatedAt: String
        let busy: Bool
        let rounds: [Round]
        let automation: Automation?
        struct Automation: Decodable, Equatable { let state: String; let reason: String? }
        var automatic: Bool { automation?.state == "running" }
        var canDecide: Bool { status == "ready" && !busy && !automatic }
        var canFinish: Bool { status == "readyToFinish" && !busy && !automatic }
        var canRerun: Bool { (status == "readyToFinish" || status == "failed") && !busy && !automatic }
        var statusLabel: String {
            switch status {
            case "reviewing": "Review in progress"
            case "ready": "Choose findings to fix"
            case "fixing": "Fixing findings"
            case "readyToFinish": "Ready to finish"
            case "failed": "Review stopped"
            default: "Review complete"
            }
        }
    }
    struct Round: Decodable, Equatable, Identifiable {
        let id: String
        let number: Int
        let status: String
        let summary: String?
        let error: String?
        let findings: [Finding]
        var selectedCount: Int { findings.filter { $0.selected && $0.remediation.state != "fixed" }.count }
    }
    struct Finding: Decodable, Equatable, Identifiable {
        let id: String
        let priority: String
        let title: String
        let body: String
        let location: Location?
        let decision: Decision
        let remediation: Remediation
        let discussion: [Discussion]
        var selected: Bool { decision.state != "rejected" }
        var priorityLabel: String {
            switch priority { case "p0": "Critical priority"; case "p1": "High priority"; case "p2": "Medium priority"; default: "Low priority" }
        }
        var stateLabel: String {
            switch remediation.state {
            case "fixed": "Fixed"
            case "fixing": "Fixing"
            case "pending": "Queued"
            case "skipped": "Skipped"
            default: selected ? "Selected" : "Skipped"
            }
        }
        struct Location: Decodable, Equatable {
            let file: String; let line: Int?; let endLine: Int?
            var label: String { file + (line.map { ":\($0)" } ?? "") }
        }
        struct Decision: Decodable, Equatable { let state: String; let reason: String? }
        struct Remediation: Decodable, Equatable { let state: String; let evidence: String? }
        struct Discussion: Decodable, Equatable, Identifiable { let id: String; let author: String; let body: String }
    }
    func command(action: String, findingID: String? = nil, selected: Bool? = nil, question: String? = nil) -> [String: Any]? {
        guard let session, let data = try? JSONEncoder().encode(target), let encoded = try? JSONSerialization.jsonObject(with: data) else { return nil }
        var input: [String: Any] = ["sessionId": session.id, "roundId": session.activeRoundId, "updatedAt": session.updatedAt, "action": action]
        if let findingID { input["findingId"] = findingID }
        if let selected { input["selected"] = selected }
        if let question { input["question"] = question }
        return ["target": encoded, "input": input]
    }
}
