import Foundation

/// A single worker owns the JavaScriptCore context. Neither cryptography nor history batches run on the UI thread.
final class AppleCryptoService: @unchecked Sendable {
    private let queue = DispatchQueue(label: "companion.crypto", qos: .userInitiated)
    private var crypto: AppleCrypto?
    private let scriptURL: URL?
    init(scriptURL: URL?) { self.scriptURL = scriptURL }

    func execute(_ command: [String: Any], completion: @escaping @Sendable (Result<[String: Any], Error>) -> Void) {
        queue.async { [self] in
            do {
                if crypto == nil {
                    guard let scriptURL else { throw AppleCrypto.Failure.unavailable }
                    crypto = try AppleCrypto(script: String(contentsOf: scriptURL, encoding: .utf8))
                }
                completion(.success(try crypto!.execute(command)))
            } catch { completion(.failure(error)) }
        }
    }
}
