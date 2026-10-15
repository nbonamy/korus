/// Fetching needs a loading overlay until the fetched transcript has painted.
/// Local selection alone is not a fetch: cached conversations swap in place.
struct ConversationLoadingState {
    private var fetching = false
    private var awaitingTranscript = false
    private var failedToRender = false
    private var hasRendered = false
    private var connected = true
    private(set) var failed = false
    var isLoading: Bool { connected && !hasRendered && (fetching || awaitingTranscript) }
    var hasTranscript: Bool { hasRendered }

    mutating func select(awaitingRender: Bool = false) {
        fetching = false
        awaitingTranscript = awaitingRender
        failed = false
        failedToRender = false
        hasRendered = false
    }

    mutating func update(fetching: Bool, failed: Bool, hasAgent: Bool, connected: Bool = true) {
        self.connected = connected
        guard connected else {
            self.fetching = false
            awaitingTranscript = false
            self.failed = false
            return
        }
        if fetching && !self.fetching { awaitingTranscript = true }
        self.fetching = fetching
        self.failed = (failed || failedToRender) && hasAgent && !fetching
        if !fetching && (failed || failedToRender || !hasAgent) { awaitingTranscript = false }
    }

    mutating func rendered() { awaitingTranscript = false; hasRendered = true }

    mutating func renderingFailed() {
        failedToRender = true
        fetching = false
        awaitingTranscript = false
        failed = true
        hasRendered = false
    }
}
