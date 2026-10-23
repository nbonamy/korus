package com.nabocorp.companion

import org.json.JSONObject

/** Form presentation only. Review execution, persistence and duplicate-start handling belong to the engine. */
internal data class ReviewChoices(
    val scope: String = "uncommitted", val thread: String = "independent", val backend: String = "",
    val model: String = "", val effort: String = "", val instructions: String = "",
    val automatic: Boolean = false, val priority: String = "p2", val rounds: Int = 3, val autoCommit: Boolean = false,
) {
    fun load(setup: JSONObject, initial: Boolean): ReviewChoices {
        val provider = setup.string("backend")
        val saved = setup.obj("preferences").obj("providers").obj(provider)
        val selected = setup.items("models").firstOrNull { it.string("id") == saved.string("model") }
        return copy(scope = if (initial) if (setup.optBoolean("uncommitted")) "uncommitted" else "branch" else scope,
            backend = provider, model = selected?.string("id").orEmpty(),
            effort = selected?.strings("efforts")?.firstOrNull { it == saved.string("reasoningEffort") }.orEmpty())
    }
    fun input(setup: JSONObject): JSONObject? {
        if (setup.optBoolean("activeReview") || setup.string("backend") != backend ||
            (if (scope == "uncommitted") !setup.optBoolean("uncommitted") else scope != "branch" || !setup.optBoolean("branchChanges") || setup.string("baseRef").isBlank()) ||
            thread !in listOf("independent", "current") || thread == "current" && (!setup.optBoolean("currentThread") || automatic) ||
            !setup.strings("backends").contains(if (thread == "current") setup.string("agentBackend") else backend)) return null
        val selected = setup.items("models").firstOrNull { it.string("id") == model }
        return json("scope" to json("type" to scope).apply { if (scope == "branch") put("baseRef", setup.string("baseRef")) },
            "threadMode" to thread,
            "automation" to json("enabled" to automatic, "maxPriority" to priority, "maxRounds" to rounds.coerceIn(1, 10), "autoCommit" to (automatic && autoCommit))).apply {
            if (thread == "independent") {
                put("backend", backend)
                selected?.let { put("model", it.string("id")); if (it.strings("efforts").contains(effort)) put("reasoningEffort", effort) }
            }
            instructions.trim().takeIf { it.isNotEmpty() }?.let { put("instructions", it) }
        }
    }
}
