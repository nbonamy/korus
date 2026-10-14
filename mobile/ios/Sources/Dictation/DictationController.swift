import Foundation
import Observation

/// The operating system owns recording and recognition; this controller owns the draft lifecycle.
@MainActor
protocol DictationCapture: AnyObject {
    func authorize() async throws
    func start(update: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (Error?) -> Void) throws
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
        let prefix = text.isEmpty || text.last?.isWhitespace == true ? text : text + " "
        do {
            let permission = Task { try await capture.authorize() }
            authorization = permission
            try await permission.value
            guard generation == id else { return }
            authorization = nil
            try capture.start(update: { [weak self] transcript in
                guard let self, self.generation == id else { return }
                update(prefix + transcript)
            }, completion: { [weak self] failure in
                guard let self, self.generation == id else { return }
                self.cancel()
                self.error = failure?.localizedDescription
            })
            if generation == id { phase = .recording }
        } catch {
            guard generation == id else { return }
            cancel()
            self.error = error.localizedDescription
        }
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
