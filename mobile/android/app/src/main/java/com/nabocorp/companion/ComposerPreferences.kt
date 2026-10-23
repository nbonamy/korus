package com.nabocorp.companion

import android.content.SharedPreferences
import androidx.compose.runtime.*

class ComposerPreferences(private val preferences: SharedPreferences) {
    var followUpBehavior by mutableStateOf(preferences.getString("composer.followUpBehavior", "steer")?.takeIf { it in listOf("steer", "queue") } ?: "steer")
        private set
    fun choose(mode: String) {
        if (mode !in listOf("steer", "queue")) return
        followUpBehavior = mode
        preferences.edit().putString("composer.followUpBehavior", mode).apply()
    }
}
