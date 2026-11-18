import Foundation

/// A single worker owns the JavaScriptCore context. Neither cryptography nor history batches run on the UI thread.
///
/// The native Noise registry belongs to one engine page. A page that dies cannot close its connections, so `reset()`
/// gives the next page a fresh registry; work the dead page left queued is refused, since session ids restart with it.
/// Call `execute` and `reset` from one thread (the main thread in the app), so a command is tagged with the page that sent it.
final class AppleCryptoService: @unchecked Sendable {
    enum Failure: Error { case staleEngine }

    private let queue = DispatchQueue(label: "companion.crypto", qos: .userInitiated)
    private var crypto: AppleCrypto?
    /// The engine page whose work is accepted; touched only on `queue`.
    private var active = 0
    private let scriptURL: URL?
    /// The engine page commands are issued for; touched only by the caller's thread.
    private(set) var generation = 0

    init(scriptURL: URL?) { self.scriptURL = scriptURL }

    /// The engine page died or was replaced: its connections go with it and its queued work is refused.
    func reset() {
        generation += 1
        let next = generation
        queue.async { [self] in crypto = nil; active = next }
    }

    func execute(_ command: [String: Any], completion: @escaping @Sendable (Result<[String: Any], Error>) -> Void) {
        execute(command, generation: generation, completion: completion)
    }

    func execute(_ command: [String: Any], generation: Int, completion: @escaping @Sendable (Result<[String: Any], Error>) -> Void) {
        queue.async { [self] in
            do {
                guard generation == active else { throw Failure.staleEngine }
                if crypto == nil {
                    guard let scriptURL else { throw AppleCrypto.Failure.unavailable }
                    crypto = try AppleCrypto(script: String(contentsOf: scriptURL, encoding: .utf8))
                }
                completion(.success(try crypto!.execute(command)))
            } catch { completion(.failure(error)) }
        }
    }
}
