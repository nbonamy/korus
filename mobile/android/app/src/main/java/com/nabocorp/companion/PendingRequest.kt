package com.nabocorp.companion

import org.json.JSONArray
import org.json.JSONObject

/** App-owned request data. The engine owns delivery, reconciliation, and provider translation. */
internal class PendingRequest(val key: String, val target: ConversationTarget, val request: JSONObject) {
    data class Option(val label: String, val description: String)
    data class Question(val id: String, val header: String, val text: String, val secret: Boolean, val multiple: Boolean, val options: List<Option>)
    data class Decision(val label: String, val value: String)
    val kind = request.string("kind")
    val title get() = if (kind == "question") "Your input is needed" else "Approval needed"
    val questions = request.obj("question").items("questions").map { q ->
        Question(q.string("id"),q.string("header"),q.string("question"),q.optBoolean("isSecret"),q.optBoolean("multiSelect"),
            q.items("options").map { Option(it.string("label"),it.string("description")) })
    }
    val decisions get() = buildList {
        if (kind == "approval") {
            val approval = request.obj("approval")
            val scopes = if (approval.isNull("allowedScopes")) listOf("once","session") else approval.strings("allowedScopes")
            if ("once" in scopes) add(Decision("Allow Once","allow"))
            if ("session" in scopes) add(Decision("Allow for Session","allow_conversation"))
            if (approval.optBoolean("canDeny",true)) add(Decision("Deny","deny"))
        } else if (kind == "toolConfirmation") {
            val confirmation = request.obj("confirmation")
            add(Decision("Allow Once","allow"))
            if (confirmation.optBoolean("allowConversation")) add(Decision("Allow for Conversation","allow_conversation"))
            if (confirmation.optBoolean("allowAlways")) add(Decision("Always Allow","always_allow"))
            add(Decision("Deny","deny"))
        }
    }
    fun sameIdentity(other: PendingRequest) = key == other.key && target == other.target && request.string("id") == other.request.string("id") && request.string("conversationId") == other.request.string("conversationId")
    fun sameContent(other: PendingRequest) = sameIdentity(other) && request.toString() == other.request.toString()
    fun reply(outcome: JSONObject) = json("target" to target.toJson(),"id" to request.string("id"),"conversationId" to request.string("conversationId"),"outcome" to outcome)
    companion object {
        fun parse(value: JSONObject): PendingRequest? {
            val key = value.string("key").takeIf { it.isNotBlank() } ?: return null
            val target = value.optJSONObject("target")?.let(ConversationTarget::parse) ?: return null
            val request = value.optJSONObject("request") ?: return null
            if (request.string("id").isBlank() || request.string("conversationId").isBlank()) return null
            val pending = PendingRequest(key,target,request)
            return pending.takeIf { when (it.kind) {
                "question" -> it.questions.isNotEmpty() && it.questions.all { q -> q.id.isNotBlank() } && it.questions.map { q -> q.id }.distinct().size == it.questions.size
                "approval" -> request.optJSONObject("approval") != null
                "toolConfirmation" -> request.optJSONObject("confirmation") != null
                else -> false
            } }
        }
    }
}

/** Kept only in the native ViewModel, including secret answers; never persisted to preferences. */
internal data class RequestDraft(val text: Map<String,String> = emptyMap(), val selections: Map<String,Set<String>> = emptyMap()) {
    fun edit(id: String, value: String) = copy(text = text + (id to value))
    fun toggle(question: PendingRequest.Question, label: String): RequestDraft {
        if (question.options.none { it.label == label }) return this
        val current = selections[question.id].orEmpty()
        val selected = when { label in current -> current - label; question.multiple -> current + label; else -> setOf(label) }
        return copy(selections = selections + (question.id to selected),text = if (question.multiple) text else text - question.id)
    }
    fun answers(questions: List<PendingRequest.Question>): JSONObject? {
        val answers = JSONObject()
        for (question in questions) {
            val custom = text[question.id].orEmpty().trim()
            val selected = question.options.map { it.label }.filter { it in selections[question.id].orEmpty() }
            val values = if (custom.isEmpty()) selected else if (question.multiple) selected + custom else listOf(custom)
            if (values.isEmpty()) return null
            answers.put(question.id,json("answers" to JSONArray(values)))
        }
        return answers.takeIf { questions.isNotEmpty() }
    }
}
