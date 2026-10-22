import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Owns one finite OS assertion for real streaming work. Expiry releases execution;
/// it never cancels the remote task or repeatedly asks for more time while hidden.
@MainActor
final class StreamBackgroundExecution {
    private let begin: (@escaping @MainActor () -> Void) -> Int?
    private let end: (Int) -> Void
    private let diagnostic: (String) -> Void
    private var identifier: Int?
    private var generation = 0
    private var exhausted = false
    private var wasForeground = true

    init(begin: @escaping (@escaping @MainActor () -> Void) -> Int?, end: @escaping (Int) -> Void,
         diagnostic: @escaping (String) -> Void = { _ in }) {
        self.begin = begin
        self.end = end
        self.diagnostic = diagnostic
    }

    #if canImport(UIKit)
    convenience init(diagnostic: @escaping (String) -> Void) {
        self.init(begin: { expiry in
            let task = UIApplication.shared.beginBackgroundTask(withName: "Finish conversation updates", expirationHandler: expiry)
            return task == .invalid ? nil : task.rawValue
        }, end: { UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: $0)) }, diagnostic: diagnostic)
    }
    #endif

    /// A live link holds a lease too: leaving for a few seconds keeps answering the laptop and relay, so the
    /// link is still there on return. iOS grants the time; expiry releases it and recovery works as before.
    nonisolated static func wantsLease(unlocked: Bool, working: Bool, sending: Bool, connected: Bool) -> Bool {
        unlocked && (working || sending || connected)
    }

    func update(working: Bool, foreground: Bool) {
        if foreground && !wasForeground { exhausted = false }
        wasForeground = foreground
        guard working else { exhausted = false; finish(); return }
        guard foreground, identifier == nil, !exhausted else { return }
        generation += 1
        let epoch = generation
        identifier = begin { [weak self] in
            guard let self, self.generation == epoch else { return }
            self.exhausted = true
            self.diagnostic("expired")
            self.finish()
        }
        exhausted = identifier == nil
        diagnostic(identifier == nil ? "unavailable" : "acquired")
    }

    private func finish() {
        guard let identifier else { return }
        self.identifier = nil
        generation += 1
        end(identifier)
        diagnostic("released")
    }
}
