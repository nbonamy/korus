package com.nabocorp.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the real Android notification manager and immutable tap intent, without contacting FCM. */
@RunWith(AndroidJUnit4::class)
class AttentionNotificationsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private fun event(id: String = "native-attention") = json("id" to id, "name" to "Builder", "kind" to "question", "createdAt" to System.currentTimeMillis(),
        "target" to json("hostId" to "host", "locationId" to "local", "teamId" to "team", "agentId" to "agent", "sessionId" to "session"))

    private fun postedIds() = manager.activeNotifications.mapNotNull {
        it.notification.extras.getString(AttentionNotifications.EXTRA_NOTIFICATION)?.let(AttentionNotification::parse)?.id
    }.toSet()
    private fun clearEvents(ids: Set<String>) {
        manager.activeNotifications.forEach { entry ->
            val id = entry.notification.extras.getString(AttentionNotifications.EXTRA_NOTIFICATION)?.let(AttentionNotification::parse)?.id
            if (id in ids) manager.cancel(entry.tag, entry.id)
        }
    }
    @Test fun latestAlertReplacesOnlyItsConversationAndMobileReadingClearsIt() {
        if (android.os.Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        val agent = "replacement-" + System.nanoTime()
        val first = event("replacement-first").put("revision", 1).apply { obj("target").put("agentId", agent) }
        val latest = JSONObject(first.toString()).put("id", "replacement-latest").put("revision", 2)
        val other = JSONObject(first.toString()).put("id", "replacement-other").apply { obj("target").put("hostId", "other-host") }
        try {
            instrumentation.runOnMainSync {
                val banners = AttentionNotifications(context).apply { foreground = true }
                listOf(first, other, latest).forEach { banners.receive(it.toString()) }
                assertEquals("replacement-latest", banners.current?.id)
                banners.dismiss("replacement-first")
                assertEquals("replacement-latest", banners.current?.id)
                banners.dismiss("replacement-latest")
                assertEquals("replacement-other", banners.current?.id)
                val queued = JSONObject(latest.toString()).put("id", "queued-newer").put("revision", 3)
                banners.receive(JSONObject(latest.toString()).put("id", "queued-old").toString())
                banners.receive(queued.toString())
                banners.dismiss("replacement-other")
                assertEquals("queued-newer", banners.current?.id)
                banners.dismiss("queued-newer")
                assertNull(banners.current)
                val inbox = AttentionNotifications(context).apply { systemEnabled = true }
                listOf(first, other, latest).forEach { inbox.receive(it.toString()) }
            }
            instrumentation.waitForIdleSync()
            assertFalse(postedIds().contains("replacement-first"))
            assertTrue(postedIds().containsAll(setOf("replacement-latest", "replacement-other")))
            instrumentation.runOnMainSync {
                val inbox = AttentionNotifications(context).apply { systemEnabled = true }
                inbox.receive(JSONObject(first.toString()).put("id", "replacement-delayed").toString())
            }
            instrumentation.waitForIdleSync()
            assertFalse(postedIds().contains("replacement-delayed"))
            instrumentation.runOnMainSync {
                AttentionNotifications(context).receive(JSONObject(latest.toString()).put("kind", "read").put("id", "mobile-read").toString())
            }
            instrumentation.waitForIdleSync()
            assertFalse(postedIds().contains("replacement-latest"))
            assertTrue(postedIds().contains("replacement-other"))
        } finally { clearEvents(setOf("replacement-first", "replacement-latest", "replacement-other", "replacement-delayed")) }
    }

    @Test fun desktopReadCancelsOlderSystemAlertsAndSuppressesLateDeliveryAfterRecreation() {
        if (android.os.Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        val old = event("read-old").put("revision", 1)
        val newer = event("read-new").put("revision", 2)
        val other = event("read-other").put("revision", 1).apply { obj("target").put("hostId", "other-host") }
        // Unique agent identity isolates the persistent checkpoint between repeatable runs.
        val agent = "read-" + System.nanoTime()
        listOf(old, newer, other).forEach { it.obj("target").put("agentId", agent) }
        instrumentation.runOnMainSync {
            val inbox = AttentionNotifications(context).apply { systemEnabled = true }
            listOf(old, newer, other).forEach { inbox.receive(it.toString()) }
        }
        try {
            instrumentation.waitForIdleSync()
            val read = JSONObject(old.toString()).put("kind", "read").put("id", "read-checkpoint")
            instrumentation.runOnMainSync { AttentionNotifications(context).receive(read.toString()) }
            instrumentation.waitForIdleSync()
            assertFalse(postedIds().contains("read-old"))
            assertTrue(postedIds().contains("read-new"))
            assertTrue(postedIds().contains("read-other"))
            instrumentation.runOnMainSync {
                val restored = AttentionNotifications(context).apply { foreground = true }
                restored.receive(old.put("id", "read-late").toString())
                assertNull(restored.current)
                restored.receive(newer.put("id", "read-new-banner").toString())
                assertEquals("read-new-banner", restored.current?.id)
            }
        } finally { clearEvents(setOf("read-old", "read-new", "read-other")) }
    }

    @Test fun backgroundAlertCarriesOnlyAttentionAndTapOpensTheCapturedTarget() {
        if (android.os.Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        val event = event()
        instrumentation.runOnMainSync {
            val notifications = AttentionNotifications(context)
            notifications.systemEnabled = true
            notifications.receive(event.toString())
        }
        try {
            val deadline = SystemClock.uptimeMillis() + 5000
            var posted: android.service.notification.StatusBarNotification? = null
            while (posted == null && SystemClock.uptimeMillis() < deadline) {
                posted = manager.activeNotifications.firstOrNull { it.notification.extras.getString(AttentionNotifications.EXTRA_NOTIFICATION)?.let(AttentionNotification::parse)?.id == event.string("id") }
                if (posted == null) SystemClock.sleep(25)
            }
            assertNotNull("The consented notification must be posted (enabled=${manager.areNotificationsEnabled()})", posted)
            val alert = posted!!.notification
            assertEquals("Builder", alert.extras.getString(Notification.EXTRA_TITLE))
            assertEquals("Has a question for you", alert.extras.getString(Notification.EXTRA_TEXT))
            assertEquals(event.toString(), alert.extras.getString(AttentionNotifications.EXTRA_NOTIFICATION))
            assertTrue(alert.contentIntent.isImmutable)
            ActivityScenario.launch(CompanionActivity::class.java).use { scenario ->
                lateinit var launchIntent: Intent
                lateinit var activity: CompanionActivity
                scenario.onActivity { launchIntent = it.intent; activity = it }
                try {
                    alert.contentIntent.send()
                    var delivered: String? = null
                    val deadline = SystemClock.uptimeMillis() + 5000
                    while (delivered == null && SystemClock.uptimeMillis() < deadline) {
                        instrumentation.runOnMainSync { delivered = activity.intent.getStringExtra(AttentionNotifications.EXTRA_NOTIFICATION) }
                        if (delivered == null) SystemClock.sleep(25)
                    }
                    assertEquals(event.toString(), delivered)
                } finally {
                    // ActivityScenario tracks the launch Intent's filter for lifecycle cleanup.
                    instrumentation.runOnMainSync { activity.intent = launchIntent }
                }
            }
        } finally { clearEvents(setOf(event.string("id"))) }
    }

    @Test fun malformedAttentionCannotBecomeAnAlertOrNavigationTarget() {
        instrumentation.runOnMainSync {
            val inbox = AttentionNotifications(context)
            inbox.foreground = true
            var opened: ConversationTarget? = null
            inbox.bindOpen { opened = it }
            val malformed = listOf(
                event("numeric-id").put("id", 123),
                event("numeric-name").put("name", 123),
                event("missing-session").apply { obj("target").remove("sessionId") },
                event("string-date").put("createdAt", System.currentTimeMillis().toString()),
            )
            malformed.forEach { value -> inbox.receive(value.toString()); inbox.tapped(value.toString()) }
            assertNull(inbox.current)
            assertNull(opened)
        }
    }

    @Test fun foregroundStreamAndPushDeduplicateWhileVisibleAndInvalidAlertsStayQuiet() {
        instrumentation.runOnMainSync {
            val inbox = AttentionNotifications(context)
            val visible = event("visible")
            inbox.foreground = true
            inbox.visibleTarget = ConversationTarget.parse(visible.obj("target"))
            inbox.receive(visible.toString())
            assertNull(inbox.current)
            val other = event("other").apply { obj("target").put("agentId", "other") }
            inbox.receive(other.toString())
            inbox.receive(other.toString())
            assertEquals("other", inbox.current?.id)
            inbox.dismiss("other")
            assertNull(inbox.current)
            inbox.receive(other.toString())
            inbox.receive(event("expired").put("createdAt", 1).toString())
            inbox.receive(event("bad").apply { obj("target").put("agentId", "") }.toString())
            assertNull(inbox.current)
            assertFalse(postedIds().any { it in setOf("visible", "other", "expired", "bad") })
        }
    }
}
