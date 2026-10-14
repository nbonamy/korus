/// Fetching needs a loading overlay until the fetched transcript has painted.
/// Local selection alone is not a fetch: cached conversations swap in place.
struct ConversationLoadingState {
    private var fetching = false
    private var awaitingTranscript = false
    var isLoading: Bool { fetching || awaitingTranscript }

    mutating func select() {
        fetching = false
        awaitingTranscript = false
    }

    mutating func update(fetching: Bool, failed: Bool, hasAgent: Bool) {
        if fetching && !self.fetching { awaitingTranscript = true }
        self.fetching = fetching
        if !fetching && (failed || !hasAgent) { awaitingTranscript = false }
    }

    mutating func rendered() { awaitingTranscript = false }
}
