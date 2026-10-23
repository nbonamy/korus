/// Transfers cover every event since the page last acknowledged painting, so the latest pending batch subsumes an older batch.
/// Hands the transcript page one message at a time and folds queued presentation work into the newest.
struct TranscriptRenderQueue {
    enum Kind: Equatable { case conversation, transfer, context }
    struct Job: Equatable { let kind: Kind; let json: String }

    private var conversation: Job?
    private var context: String?
    private(set) var isBusy = false

    /// A newer conversation replaces everything waiting (it already carries the context it was sent with);
    /// a newer context only replaces an older context. Returns the job to start now, if the page is free.
    mutating func enqueue(_ kind: Kind, _ json: String) -> Job? {
        switch kind {
        case .conversation, .transfer: conversation = Job(kind: kind, json: json); context = nil
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
        if let job = conversation { conversation = nil; isBusy = true; return job }
        if let json = context { context = nil; isBusy = true; return Job(kind: .context, json: json) }
        return nil
    }
}
