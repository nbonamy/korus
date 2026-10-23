package com.nabocorp.companion

import android.content.SharedPreferences
import androidx.compose.runtime.*
import org.json.JSONArray

/** Presentation preferences are scoped to the paired computer and team, never to the transcript. */
internal class SidebarPreferences(private val preferences: SharedPreferences) {
    var owner by mutableStateOf<Pair<String,String>?>(null)
        private set
    var organization by mutableStateOf("activity")
        private set
    var idleSort by mutableStateOf("activity")
        private set
    private fun key(kind: String) = "sidebar.$kind:${JSONArray(listOf(owner?.first, owner?.second))}"
    fun select(hostId: String, teamId: String): Boolean {
        val next = if (hostId.isBlank() || teamId.isBlank()) null else hostId to teamId
        if (next == owner) return false
        owner = next
        organization = preferences.getString(key("organization"), "activity").takeIf { next != null && it in listOf("activity","repository") } ?: "activity"
        idleSort = preferences.getString(key("idleSort"), "activity").takeIf { next != null && it in listOf("activity","repository") } ?: "activity"
        return next != null
    }
    fun organize(mode: String) {
        if (owner == null || mode !in listOf("activity","repository")) return
        organization = mode; preferences.edit().putString(key("organization"), mode).apply()
    }
    fun sortIdle(order: String): Boolean {
        if (owner == null || order !in listOf("activity","repository") || order == idleSort) return false
        idleSort = order; preferences.edit().putString(key("idleSort"), order).apply()
        return true
    }
}
