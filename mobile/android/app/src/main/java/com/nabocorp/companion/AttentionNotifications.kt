package com.nabocorp.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.*
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import kotlin.math.abs

data class ConversationTarget(val hostId: String, val locationId: String, val teamId: String, val agentId: String, val sessionId: String?) {
    fun toJson() = json("hostId" to hostId, "locationId" to locationId, "teamId" to teamId, "agentId" to agentId, "sessionId" to sessionId)
    companion object {
        fun parse(value: JSONObject): ConversationTarget? {
            val ids = listOf("hostId", "locationId", "teamId", "agentId").map { value.opt(it) as? String ?: return null }
            if (ids.any { it.isBlank() || it.length > 256 }) return null
            if (!value.has("sessionId")) return null
            val session = if (value.isNull("sessionId")) null else value.opt("sessionId") as? String ?: return null
            if (session != null && session.length > 1000) return null
            return ConversationTarget(ids[0], ids[1], ids[2], ids[3], session)
        }
    }
}

data class AttentionNotification(val id: String, val target: ConversationTarget, val kind: String, val name: String, val createdAt: Long, val source: String, val revision: Long? = null) {
    val message get() = when (kind) { "completed" -> "Finished its turn"; "approval" -> "Needs your approval"; else -> "Has a question for you" }
    companion object {
        fun parse(source: String): AttentionNotification? = runCatching {
            if (source.length > 8192) return null
            val data = JSONObject(source)
            val id = data.opt("id") as? String ?: return null
            val name = data.opt("name") as? String ?: return null
            val kind = data.opt("kind") as? String ?: return null
            val createdAt = data.opt("createdAt") as? Number ?: return null
            if (!createdAt.toDouble().isFinite() || createdAt.toDouble() != createdAt.toLong().toDouble()) return null
            if (!id.matches(Regex("[A-Za-z0-9_-]{1,64}")) || name.length > 100 || kind !in setOf("completed", "approval", "question", "read")) return null
            val revision = if (!data.has("revision")) null else {
                val raw = data.opt("revision") as? Number ?: return null
                if (!raw.toDouble().isFinite() || raw.toDouble() != raw.toLong().toDouble() || raw.toLong() < 0) return null
                raw.toLong()
            }
            if (kind == "read" && revision == null) return null
            AttentionNotification(id, ConversationTarget.parse(data.getJSONObject("target")) ?: return null, kind, name, createdAt.toLong(), source, revision)
        }.getOrNull()
    }
}

/** Both live events and FCM enter this inbox. Dismissal changes presentation, never daemon read state. */
class AttentionNotifications(private val context: Context) {
    companion object { const val EXTRA_NOTIFICATION = "companion.notification"; private const val CHANNEL = "agent-attention" }
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val reads = context.getSharedPreferences("notification-reads", Context.MODE_PRIVATE)
    private fun key(target: ConversationTarget) = org.json.JSONArray(listOf(target.hostId, target.locationId, target.teamId, target.agentId)).toString()
    private fun isRead(notification: AttentionNotification): Boolean = notification.revision?.let { it <= reads.getLong(key(notification.target), -1) } ?: false
    private val seen = linkedSetOf<String>()
    private val queued = ArrayDeque<AttentionNotification>()
    private var pendingOpen: ConversationTarget? = null
    private var open: ((ConversationTarget) -> Unit)? = null
    var current by mutableStateOf<AttentionNotification?>(null)
        private set
    var foreground = false
    var systemEnabled = false
    var visibleTarget: ConversationTarget? = null
        set(value) {
            field = value
            queued.removeAll { it.target == value }
            if (current?.target == value) current?.let { dismiss(it.id) }
            manager.activeNotifications.forEach { active ->
                val notification = active.notification.extras.getString(EXTRA_NOTIFICATION)?.let(AttentionNotification::parse)
                if (value != null && notification?.target == value) manager.cancel(active.tag, active.id)
            }
        }
    init { manager.createNotificationChannel(NotificationChannel(CHANNEL, "Agent activity", NotificationManager.IMPORTANCE_HIGH).apply { description = "Completed turns, questions, and approval requests" }) }
    fun bindOpen(handler: (ConversationTarget) -> Unit): () -> Unit {
        open = handler
        pendingOpen?.let { pendingOpen = null; handler(it) }
        return { if (open === handler) open = null }
    }
    fun tapped(source: String) {
        val notification = AttentionNotification.parse(source) ?: return
        remember(notification.id); manager.cancel(notification.id, 0); dismiss(notification.id)
        if (open == null) pendingOpen = notification.target else open?.invoke(notification.target)
    }
    fun receive(source: String) {
        val notification = AttentionNotification.parse(source) ?: return
        if (notification.kind == "read") {
            val key = key(notification.target)
            if (notification.revision!! > reads.getLong(key, -1)) reads.edit().putLong(key, notification.revision).commit()
            queued.removeAll { isRead(it) }
            if (current?.let { isRead(it) } == true) current = queued.removeFirstOrNull()
            manager.activeNotifications.forEach { active ->
                val posted = active.notification.extras.getString(EXTRA_NOTIFICATION)?.let(AttentionNotification::parse)
                if (posted != null && isRead(posted)) manager.cancel(active.tag, active.id)
            }
            return
        }
        if (isRead(notification)) return
        if (abs(System.currentTimeMillis().toDouble() - notification.createdAt.toDouble()) > 300_000 || !seen.add(notification.id)) return
        if (seen.size > 256) seen.remove(seen.first())
        if (foreground) {
            if (notification.target == visibleTarget) return
            if (current == null) current = notification else { queued.addLast(notification); if (queued.size > 8) queued.removeFirst() }
        } else if (systemEnabled && manager.areNotificationsEnabled()) {
            val intent = Intent(context, CompanionActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .setData(Uri.Builder().scheme(context.packageName).authority("attention").appendPath(notification.id).build())
                .putExtra(EXTRA_NOTIFICATION, notification.source)
            val tap = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val alert = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_attention)
                .setContentTitle(notification.name).setContentText(notification.message)
                .setContentIntent(tap).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setTimeoutAfter(300_000)
                .addExtras(android.os.Bundle().apply { putString(EXTRA_NOTIFICATION, notification.source) }).build()
            runCatching { manager.notify(notification.id, 0, alert) }
        }
    }
    private fun remember(id: String) { seen.add(id); if (seen.size > 256) seen.remove(seen.first()) }
    fun dismiss(id: String) { if (current?.id == id) current = queued.removeFirstOrNull() }
    fun clear() { current = null; queued.clear() }
}
