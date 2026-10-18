package com.nabocorp.companion

import android.app.NotificationManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*
import org.json.JSONObject
import java.util.concurrent.Executors

/** Firebase is optional and is initialized only after notification consent. No Analytics SDK. */
class PushNotifications(private val context: Context, private val attention: AttentionNotifications, private val client: PushRegistrationClient?) {
    companion object {
        private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "companion-push").apply { isDaemon = true } }
    }
    private val main = Handler(Looper.getMainLooper())
    private var operation = 0
    private var registering = false
    private val preferences = context.getSharedPreferences("preferences", Context.MODE_PRIVATE)
    val configured get() = client != null
    var status by mutableStateOf("Enable notifications")
        private set
    var error by mutableStateOf<String?>(null)
    private var registration: JSONObject? = null
    private val observers = mutableSetOf<(JSONObject?) -> Unit>()
    fun observe(observer: (JSONObject?) -> Unit): () -> Unit {
        observers.add(observer); observer(registration)
        return { observers.remove(observer) }
    }
    fun enable() {
        if (!configured) { status = "Notifications unavailable"; return }
        if (!context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Notifications are off"; return }
        preferences.edit().putBoolean("notifications.enabled", true).apply()
        refresh()
    }
    fun disable() {
        preferences.edit().putBoolean("notifications.enabled", false).apply()
        attention.systemEnabled = false
        operation++; registering = false; error = null
        publish(null); status = "Enable notifications"
        worker.execute { try { client?.unregister() } catch (failure: Exception) { diagnose(failure) } }
    }
    fun refresh() {
        val allowed = preferences.getBoolean("notifications.enabled", false) && context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        attention.systemEnabled = allowed && configured
        if (!attention.systemEnabled) {
            operation++; registering = false
            publish(null); status = if (preferences.getBoolean("notifications.enabled", false)) "Notifications are off" else "Enable notifications"
            return
        }
        val client = client ?: return
        if (registering) return
        val current = ++operation
        registering = true; error = null; status = "Connecting notifications…"
        worker.execute {
            val failure = runCatching { client.register() }.exceptionOrNull()
            if (failure is Exception) diagnose(failure)
            main.post {
                if (current == operation) {
                    registering = false
                    if (failure != null && attention.systemEnabled) { error = "Push notifications couldn’t connect. In-app alerts are still available."; status = "Retry notifications" }
                }
            }
        }
    }
    fun tokenChanged(token: String) {
        if (!attention.systemEnabled || token.isBlank()) return
        error = null; status = "Notifications on"
        publish(json("transport" to "fcm", "environment" to "production", "token" to token))
    }
    private fun publish(value: JSONObject?) {
        registration = value; observers.toList().forEach { it(value) }
    }
    private fun diagnose(failure: Exception) {
        if (BuildConfig.DEBUG) {
            val code = failure.message?.takeIf { it.matches(Regex("[A-Z_]{3,80}")) } ?: failure.javaClass.simpleName
            val origin = failure.stackTrace.take(3).joinToString(" ← ") { "${it.className}.${it.methodName}:${it.lineNumber}" }
            android.util.Log.w("CompanionPush", "Registration failed: $code at $origin")
        }
    }
}
