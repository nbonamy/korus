package com.nabocorp.companion

import android.content.SharedPreferences
import android.os.SystemClock
import androidx.compose.runtime.*

/** Device-owner verification protects presentation, never changes the saved computer pairing. */
class AppLock(
    private val preferences: SharedPreferences,
    private val available: () -> Boolean,
    private val now: () -> Long = SystemClock::elapsedRealtime,
) {
    private enum class Request { ENABLE, UNLOCK }
    private var request: Request? = null
    private var leftAt: Long? = null
    private val observers = linkedSetOf<() -> Unit>()
    var isEnabled by mutableStateOf(preferences.getBoolean("appLock.enabled", false))
        private set
    var canProtect by mutableStateOf(available())
        private set
    var isLocked by mutableStateOf(isEnabled && canProtect)
        private set
    var isAuthenticating by mutableStateOf(false)
        private set
    val isProtecting get() = isEnabled && canProtect

    fun observe(observer: () -> Unit): () -> Unit {
        observers.add(observer)
        return { observers.remove(observer) }
    }
    private fun changed() { observers.toList().forEach { it() } }

    fun setEnabled(enabled: Boolean, authenticate: (String) -> Unit) {
        if (isLocked || isAuthenticating) return
        canProtect = available()
        if (enabled) {
            if (!canProtect || isEnabled) return
            request = Request.ENABLE
            isAuthenticating = true
            authenticate("Turn on the lock.")
        } else {
            isEnabled = false
            preferences.edit().putBoolean("appLock.enabled", false).apply()
            changed()
        }
    }
    fun unlock(authenticate: (String) -> Unit) {
        if (!isLocked || isAuthenticating) return
        request = Request.UNLOCK
        isAuthenticating = true
        authenticate("Unlock to see your conversations.")
    }
    /** Called only by the platform authentication callback; a callback without a request grants nothing. */
    fun authenticationResult(verified: Boolean) {
        val completing = request ?: return
        request = null
        isAuthenticating = false
        canProtect = available()
        if (verified && canProtect) {
            if (completing == Request.ENABLE) {
                isEnabled = true
                preferences.edit().putBoolean("appLock.enabled", true).apply()
            }
            isLocked = false
        }
        changed()
    }
    fun didLeave() { if (leftAt == null) leftAt = now() }
    fun didReturn() {
        canProtect = available()
        if (!canProtect) isLocked = false
        else if (isProtecting && leftAt?.let { now() - it >= 300_000 } == true) isLocked = true
        leftAt = null
        changed()
    }
}
