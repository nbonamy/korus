/// Hands the transcript page one message at a time: the page redraws a whole conversation per message, so
/// messages that pile up while it works are folded into the newest instead of each being drawn.
struct TranscriptRenderQueue {
    enum Kind: Equatable { case conversation, context }
    struct Job: Equatable { let kind: Kind; let json: String }

    private var conversation: String?
    private var context: String?
    private(set) var isBusy = false

    /// A newer conversation replaces everything waiting (it already carries the context it was sent with);
    /// a newer context only replaces an older context. Returns the job to start now, if the page is free.
    mutating func enqueue(_ kind: Kind, _ json: String) -> Job? {
        switch kind {
        case .conversation: conversation = json; context = nil
        case .context: context = json
        }
        return isBusy ? nil : start()
    }

    /// The page finished its job; returns the next one, which is the latest of what arrived meanwhile.
    mutating func finish() -> Job? {
        isBusy = false
        return start()
    }

    private mutating func start() -> Job? {
        if let json = conversation { conversation = nil; isBusy = true; return Job(kind: .conversation, json: json) }
        if let json = context { context = nil; isBusy = true; return Job(kind: .context, json: json) }
        return nil
    }
}
