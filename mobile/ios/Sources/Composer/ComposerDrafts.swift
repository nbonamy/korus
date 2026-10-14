import Foundation
import Observation

struct ComposerTarget: Codable, Hashable, Sendable {
    let hostId: String
    let locationId: String
    let teamId: String
    let agentId: String
    let sessionId: String?

    enum CodingKeys: String, CodingKey { case hostId, locationId, teamId, agentId, sessionId }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(hostId, forKey: .hostId)
        try values.encode(locationId, forKey: .locationId)
        try values.encode(teamId, forKey: .teamId)
        try values.encode(agentId, forKey: .agentId)
        // Null is part of the companion target contract for a new provider conversation.
        try values.encode(sessionId, forKey: .sessionId)
    }
}

struct ComposerAttachment: Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case image, file }
    let id = UUID()
    let name: String
    let mimeType: String
    let type: Kind
    let data: Data
}

struct ComposerSendResult: Decodable {
    enum Status: String, Decodable { case accepted, rejected, unknown }
    let requestId: String
    let status: Status
}

/// Device-local drafts, keyed by the full laptop/conversation identity. Bytes never enter transcript state.
@Observable
@MainActor
final class ComposerDrafts {
    static let maxCount = 5
    static let maxBytes = 2_500_000
    struct Import: Identifiable, Equatable { let id = UUID(); let target: ComposerTarget }
    struct Submission: Encodable {
        struct Upload: Encodable { let type: ComposerAttachment.Kind; let name: String; let mimeType: String; let data: String }
        let type = "send"
        let requestId: String
        let target: ComposerTarget
        let text: String
        let goalMode: Bool
        let uploads: [Upload]
    }
    private struct Draft {
        var text = ""
        var goalMode = false
        var items: [ComposerAttachment] = []
        var loading: Import?
        var sending: String?
        var error: String?
    }
    private struct Pending { let submission: Submission; let ids: Set<UUID> }
    private var draft = Draft()
    private var retained: [ComposerTarget: Draft] = [:]
    private var pending: [String: Pending] = [:]
    private(set) var target: ComposerTarget?
    var text: String { get { draft.text } set { draft.text = newValue } }
    var goalMode: Bool { draft.goalMode }
    func setGoalMode(_ on: Bool) {
        guard !sending, !importing, !on || items.isEmpty else { return }
        draft.goalMode = on
    }
    var items: [ComposerAttachment] { draft.items }
    var importing: Bool { draft.loading != nil }
    var sending: Bool { draft.sending != nil }
    var error: String? { draft.error }
    var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && items.isEmpty }

    func select(_ next: ComposerTarget?) {
        guard next != target else { return }
        if let target { retained[target] = draft }
        target = next
        draft = next.flatMap { retained.removeValue(forKey: $0) } ?? Draft()
    }

    func beginImport() -> Import? {
        guard let target, !goalMode, !importing, !sending else { return nil }
        let request = Import(target: target)
        draft.loading = request
        draft.error = nil
        return request
    }

    func finishImport(_ request: Import, attachments: [ComposerAttachment], error: String? = nil) {
        change(request.target) { draft in
            guard draft.loading == request else { return }
            draft.loading = nil
            if let error { draft.error = error; return }
            guard draft.items.count + attachments.count <= Self.maxCount else { draft.error = "You can attach up to 5 files or photos."; return }
            guard (draft.items + attachments).reduce(0, { $0 + $1.data.count }) <= Self.maxBytes else {
                draft.error = "Attachments must total 2.5 MB or less."; return
            }
            draft.items += attachments
        }
    }

    func remove(_ id: UUID) { if !sending { draft.items.removeAll { $0.id == id }; draft.error = nil } }
    func dismissError() { draft.error = nil }

    func beginSend() -> Submission? {
        guard let target, !empty, !importing, !sending, !goalMode || items.isEmpty else { return nil }
        let request = Submission(requestId: UUID().uuidString, target: target, text: text.trimmingCharacters(in: .whitespacesAndNewlines), goalMode: goalMode, uploads: items.map {
            .init(type: $0.type, name: $0.name, mimeType: $0.mimeType, data: $0.data.base64EncodedString())
        })
        draft.sending = request.requestId
        draft.error = nil
        pending[request.requestId] = Pending(submission: request, ids: Set(items.map(\.id)))
        return request
    }

    func completeSend(_ result: ComposerSendResult) {
        guard let sent = pending.removeValue(forKey: result.requestId) else { return }
        change(sent.submission.target) { draft in
            guard draft.sending == result.requestId else { return }
            draft.sending = nil
            switch result.status {
            case .accepted:
                if sent.submission.goalMode { draft.goalMode = false }
                draft.items.removeAll { sent.ids.contains($0.id) }
                if draft.text.trimmingCharacters(in: .whitespacesAndNewlines) == sent.submission.text { draft.text = "" }
            case .rejected: draft.error = "Couldn’t send. Your draft and attachments are still here."
            case .unknown: draft.error = "Delivery couldn’t be confirmed. Check the conversation before sending again."
            }
        }
    }

    private func change(_ owner: ComposerTarget, _ body: (inout Draft) -> Void) {
        if owner == target { body(&draft) }
        else { var saved = retained[owner] ?? Draft(); body(&saved); retained[owner] = saved }
    }
}
