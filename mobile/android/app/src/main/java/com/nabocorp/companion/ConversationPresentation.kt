package com.nabocorp.companion

/** Native presentation readiness, never a provider transcript or reducer. */
internal data class ConversationPresentation(
    val fetching: Boolean = false,
    val awaitingPaint: Boolean = false,
    val hasTranscript: Boolean = false,
    val renderFailed: Boolean = false,
    val fetchFailed: Boolean = false,
    val connected: Boolean = true,
    val hasAgent: Boolean = false,
) {
    val failed get() = connected && hasAgent && (renderFailed || fetchFailed && !fetching)
    val loading get() = connected && hasAgent && !hasTranscript && !failed && (fetching || awaitingPaint)
    fun update(next: org.json.JSONObject): ConversationPresentation {
        val online = next.string("connection") == "connected"
        val fetching = online && next.optBoolean("loading")
        return copy(fetching = fetching,awaitingPaint = online && (awaitingPaint || fetching && !this.fetching),
            fetchFailed = online && next.string("error") == "mobile.errors.loadConversation",connected = online,hasAgent = next.string("agentId").isNotBlank())
    }
    fun rendered() = copy(awaitingPaint = false,hasTranscript = true)
    fun failedToRender() = copy(fetching = false,awaitingPaint = false,hasTranscript = false,renderFailed = true)
}
