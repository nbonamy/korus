import Foundation
import Observation

struct DictationResult: Sendable {
    let text: String
    /// A completed utterance within the audio stream; the recording can continue.
    var finalizedUtteranceStart: TimeInterval? = nil
}

/// The operating system owns recording and recognition; this controller owns the draft lifecycle.
@MainActor
protocol DictationCapture: AnyObject {
    func authorize() async throws
    func start(update: @escaping @MainActor (DictationResult) -> Void, completion: @escaping @MainActor (Error?) -> Void) throws
    func finish()
    func cancel()
}

@Observable
@MainActor
final class DictationController {
    enum Phase { case idle, requesting, recording, finishing }
    private(set) var phase: Phase = .idle
    var error: String?
    var active: Bool { phase != .idle }
    private let capture: any DictationCapture
    private var generation = UUID()
    private var authorization: Task<Void, Error>?
    private var completionTimeout: Task<Void, Never>?

    init(capture: any DictationCapture) { self.capture = capture }

    func start(text: String, update: @escaping @MainActor (String) -> Void) async {
        guard !active else { return }
        error = nil
        phase = .requesting
        let id = UUID()
        generation = id
        do {
            let permission = Task { try await capture.authorize() }
            authorization = permission
            try await permission.value
        } catch {
            guard generation == id else { return }
            cancel()
            self.error = error.localizedDescription
            return
        }
        guard generation == id else { return }
        authorization = nil
        do { try beginCapture(text: text, update: update) }
        catch { cancel(); self.error = error.localizedDescription }
    }

    private func beginCapture(text: String, update: @escaping @MainActor (String) -> Void) throws {
        let id = UUID()
        generation = id
        let prefix = text.isEmpty || text.last?.isWhitespace == true ? text : text + " "
        var utterances: [(start: TimeInterval, text: String)] = []
        var draft = text
        phase = .recording
        try capture.start(update: { [weak self] result in
            guard let self, self.generation == id, !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            if let start = result.finalizedUtteranceStart {
                // Repeated/cumulative final results replace their audio range rather than duplicating it.
                utterances.removeAll { $0.start >= start }
                utterances.append((start, result.text))
                draft = prefix + utterances.map(\.text).joined(separator: " ")
            } else {
                draft = prefix + (utterances.map(\.text) + [result.text]).joined(separator: " ")
            }
            update(draft)
        }, completion: { [weak self] failure in
            guard let self, self.generation == id else { return }
            if failure == nil && self.phase == .recording {
                do { try self.beginCapture(text: draft, update: update) }
                catch { self.cancel(); self.error = error.localizedDescription }
            } else {
                self.cancel()
                self.error = failure?.localizedDescription
            }
        })
    }

    /// Stop capturing immediately, but let recognition deliver its last words.
    func finish() {
        guard phase == .recording else { cancel(); return }
        phase = .finishing
        let id = generation
        capture.finish()
        completionTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self, self.generation == id else { return }
            self.cancel()
        }
    }

    /// Freeze the latest draft on send, navigation, or backgrounding. Ignore all late callbacks.
    func cancel() {
        generation = UUID()
        authorization?.cancel()
        authorization = nil
        completionTimeout?.cancel()
        completionTimeout = nil
        capture.cancel()
        phase = .idle
    }
}
