package com.nabocorp.companion

import android.util.Base64
import androidx.compose.runtime.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ComposerAttachment(val name: String, val mimeType: String, val type: String, val data: ByteArray, val id: String = UUID.randomUUID().toString())

/** Native drafts belong to a complete host/conversation identity, independently of transcript state. */
class ComposerDrafts {
    companion object { const val MAX_COUNT = 5; const val MAX_BYTES = 2_500_000 }
    data class Import(val target: ConversationTarget, val id: String = UUID.randomUUID().toString())
    private data class Draft(val text: String = "", val chips: List<ComposerChip> = emptyList(), val items: List<ComposerAttachment> = emptyList(), val goal: Boolean = false,
        val loading: Import? = null, val sending: String? = null, val error: String? = null)
    private data class Pending(var owner: ConversationTarget, val text: String, val attachmentIds: Set<String>, val goal: Boolean)
    private var draft by mutableStateOf(Draft())
    private val retained = mutableMapOf<ConversationTarget, Draft>()
    private val pending = mutableMapOf<String, Pending>()
    var target by mutableStateOf<ConversationTarget?>(null)
        private set
    var text: String
        get() = draft.text
        set(value) { draft = draft.copy(text = value, chips = if (value == draft.text) draft.chips else emptyList(), error = null) }
    var chips: List<ComposerChip>
        get() = draft.chips
        set(value) { draft = draft.copy(chips = value) }
    val items get() = draft.items
    val goalMode get() = draft.goal
    val importing get() = draft.loading != null
    val sending get() = draft.sending != null
    val error get() = draft.error
    val empty get() = text.isBlank() && items.isEmpty()

    fun select(next: ConversationTarget?) {
        if (next == target) return
        target?.let { retained[it] = draft }
        target = next
        if (next != null && next.sessionId != null && next !in retained) {
            val source = retained.keys.firstOrNull { old -> old.sessionId == null && old.copy(sessionId = next.sessionId) == next
                && pending.values.any { it.owner == old && !it.goal } }
            if (source != null) {
                retained[next] = retained.remove(source)!!
                pending.values.filter { it.owner == source }.forEach { it.owner = next }
            }
        }
        draft = next?.let { retained.remove(it) } ?: Draft()
    }
    fun setGoalMode(value: Boolean) {
        if (sending || importing || value && items.isNotEmpty()) return
        draft = draft.copy(goal = value)
    }
    fun beginImport(): Import? {
        val owner = target ?: return null
        if (goalMode || importing || sending) return null
        return Import(owner).also { draft = draft.copy(loading = it, error = null) }
    }
    fun finishImport(request: Import, attachments: List<ComposerAttachment>, error: String? = null) = change(request.target) { current ->
        if (current.loading != request) current else {
            val failure = error ?: when {
                current.items.size + attachments.size > MAX_COUNT -> "You can attach up to 5 files or photos."
                current.items.sumOf { it.data.size.toLong() } + attachments.sumOf { it.data.size.toLong() } > MAX_BYTES -> "Attachments must total 2.5 MB or less."
                else -> null
            }
            current.copy(loading = null, error = failure, items = if (failure == null) current.items + attachments else current.items)
        }
    }
    fun remove(id: String) { if (!sending) draft = draft.copy(items = items.filterNot { it.id == id }, error = null) }
    fun dismissError() { draft = draft.copy(error = null) }
    fun beginSend(mode: String): JSONObject? {
        val owner = target ?: return null
        if (empty || importing || sending || goalMode && items.isNotEmpty() || mode !in listOf("steer", "queue")) return null
        val id = UUID.randomUUID().toString()
        val command = json("type" to "send", "requestId" to id, "target" to owner.toJson(), "text" to text.trim(), "goalMode" to goalMode,
            "followUpBehavior" to mode, "uploads" to JSONArray().apply { items.forEach { item -> put(json("type" to item.type, "name" to item.name, "mimeType" to item.mimeType, "data" to Base64.encodeToString(item.data, Base64.NO_WRAP))) } })
        if (chips.isNotEmpty() && !goalMode) command.put("options", json("content" to composerPromptContent(text, chips)))
        pending.entries.removeAll { it.value.owner == owner }
        pending[id] = Pending(owner, text.trim(), items.map { it.id }.toSet(), goalMode)
        draft = draft.copy(sending = id, error = null)
        return command
    }
    fun completeSend(requestId: String, status: String) {
        if (status !in listOf("accepted", "rejected", "unknown")) return
        val sent = pending[requestId] ?: return
        if (status != "unknown") pending.remove(requestId)
        change(sent.owner) { current ->
            if (current.sending != null && current.sending != requestId) current
            else when (status) {
                "accepted" -> current.copy(sending = null, error = null, goal = if (sent.goal) false else current.goal,
                    text = if (current.text.trim() == sent.text) "" else current.text, chips = if (current.text.trim() == sent.text) emptyList() else current.chips, items = current.items.filterNot { it.id in sent.attachmentIds })
                "unknown" -> current.copy(sending = null, error = "Delivery couldn’t be confirmed. Check the conversation before sending again.")
                else -> current.copy(sending = null, error = "Couldn’t send. Your draft and attachments are still here.")
            }
        }
    }
    fun deliveryInterrupted() { pending.keys.toList().forEach { completeSend(it,"unknown") } }
    private fun change(owner: ConversationTarget, transform: (Draft) -> Draft) {
        if (target == owner) draft = transform(draft)
        else retained[owner] = transform(retained[owner] ?: Draft())
    }
}
