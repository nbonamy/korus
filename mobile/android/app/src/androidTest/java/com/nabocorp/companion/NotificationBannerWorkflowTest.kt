package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.platform.AccessibilityManager
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Banner failures: dismissal marks work read or opens it, queued banners inherit
 * expired timers, accessibility timeouts are ignored, long names hide controls,
 * or a tap loses part of its captured conversation identity. */
class NotificationBannerWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private var recommended by mutableLongStateOf(Long.MAX_VALUE)
    private val timeoutRequests = mutableListOf<List<Any>>()
    private val accessibility = object : AccessibilityManager {
        override fun calculateRecommendedTimeoutMillis(originalTimeoutMillis: Long, containsIcons: Boolean, containsText: Boolean, containsControls: Boolean): Long {
            timeoutRequests += listOf(originalTimeoutMillis, containsIcons, containsText, containsControls)
            return recommended
        }
    }
    @After fun restoreClock() { app.mainClock.autoAdvance = true }
    private fun state(title: String = "Current agent") = json("startup" to "ready", "connection" to "connected", "laptopId" to "host", "teamId" to "team", "agentId" to "current", "canSend" to true,
        "laptops" to JSONArray().put(json("id" to "host")), "teams" to JSONArray().put(json("id" to "team", "name" to "Team")),
        "header" to json("title" to title, "status" to "idle"), "composerTarget" to ConversationTarget("host", "local", "team", "current", "session").toJson())
    private fun mount(e: NativeEngineFixture, fontScale: Float = 1f) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state())
        app.activityRule.scenario.onActivity { activity -> activity.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalAccessibilityManager provides accessibility, LocalDensity provides Density(density.density, fontScale)) {
                CompanionTheme { CompanionApp(e.model, {}, {}, {}, {}, {}, {}) }
            }
        } }
        app.runOnIdle { e.model.activity(true) }
    }
    private fun event(id: String, name: String, kind: String = "question") = json("id" to id, "name" to name, "kind" to kind, "createdAt" to System.currentTimeMillis(),
        "target" to ConversationTarget("host", "remote-context", "other-team", "agent-$id", "provider/session:$id").toJson())
    private fun receive(e: NativeEngineFixture, value: JSONObject) {
        app.runOnIdle { e.model.attention.receive(value.toString()) }
        if (!app.mainClock.autoAdvance) app.mainClock.advanceTimeBy(400)
    }
    private fun noNavigationOrRead(e: NativeEngineFixture) {
        assertTrue(e.commands().none { it.string("type") in listOf("read", "openNotification", "selectAgent") })
    }

    @Test fun swipeAccessibleDismissAndCloseButtonDrainTheQueueWithoutOpeningOrReadingWork() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e)
            receive(e, event("first", "First agent")); receive(e, event("second", "Second agent", "approval")); receive(e, event("third", "Third agent", "completed"))
            app.onNodeWithTag("attention-banner").performTouchInput { swipeUp() }
            app.onNodeWithText("First agent").assertDoesNotExist()
            app.onNodeWithText("Second agent").assertIsDisplayed()
            app.onNodeWithTag("attention-banner").performSemanticsAction(SemanticsActions.Dismiss) { assertTrue(it()) }
            app.onNodeWithText("Second agent").assertDoesNotExist()
            app.onNodeWithText("Third agent").assertIsDisplayed()
            app.onNodeWithContentDescription("Dismiss notification").performClick()
            app.onNodeWithTag("attention-banner").assertDoesNotExist()
            noNavigationOrRead(e)
        }
    }

    @Test fun largeTextKeepsDismissSeparateAndTheFullNameAccessibleWhileTapUsesTheCapturedTarget() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, fontScale = 1.6f)
            val name = "🚀 Build " + "agent ".repeat(12)
            val notification = event("captured", name, "completed")
            receive(e, notification)
            val open = app.onNodeWithContentDescription("$name, Finished its turn").assertIsDisplayed()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            val close = app.onNodeWithContentDescription("Dismiss notification").assertIsDisplayed()
            val openBounds = open.getUnclippedBoundsInRoot(); val closeBounds = close.getUnclippedBoundsInRoot()
            assertTrue(openBounds.right <= closeBounds.left)
            assertTrue(closeBounds.right.value - closeBounds.left.value >= 47.9f && closeBounds.bottom.value - closeBounds.top.value >= 47.9f)
            val layout = mutableListOf<TextLayoutResult>()
            app.onNodeWithText(name, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layout)) }
            assertEquals("The agent name stays on one line", 1, layout.single().lineCount)
            android.util.Log.i("NotificationLayoutCheck", json("fontScale" to 1.6, "openBounds" to openBounds.toString(), "dismissBounds" to closeBounds.toString(), "nameLines" to layout.single().lineCount, "screenshotsCaptured" to false).toString())
            open.performClick()
            app.waitUntil(5_000) { e.commands().any { it.string("type") == "openNotification" } }
            assertEquals(ConversationTarget.parse(notification.obj("target")), ConversationTarget.parse(e.commands().single { it.string("type") == "openNotification" }.obj("target")))
            app.onNodeWithTag("attention-banner").assertDoesNotExist()
            assertTrue(e.commands().none { it.string("type") == "read" })
        }
    }

    @Test fun eachQueuedBannerGetsItsOwnTimeoutAndUnrelatedUpdatesDoNotRestartTheFirst() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            recommended = 6_000; mount(e)
            app.runOnIdle { e.model.editDraft("Keep this draft") }
            app.mainClock.autoAdvance = false
            receive(e, event("timed-first", "First timed agent")); receive(e, event("timed-next", "Next timed agent"))
            app.mainClock.advanceTimeBy(3_600)
            app.onNodeWithText("First timed agent").assertIsDisplayed()
            e.state(state("Updated current title"))
            app.mainClock.advanceTimeBy(2_000)
            app.mainClock.advanceTimeBy(400)
            app.onNodeWithText("First timed agent").assertDoesNotExist()
            app.onNodeWithText("Next timed agent").assertIsDisplayed()
            app.mainClock.advanceTimeBy(4_500)
            app.onNodeWithText("Next timed agent").assertIsDisplayed()
            app.mainClock.advanceTimeBy(1_500)
            app.onNodeWithTag("attention-banner").assertDoesNotExist()
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            noNavigationOrRead(e)
        }
    }

    @Test fun accessibilityCanHoldABannerOrExtendItsTimeoutBeyondSixSeconds() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e); app.mainClock.autoAdvance = false
            receive(e, event("held", "Held agent"))
            app.mainClock.advanceTimeBy(9_000)
            app.onNodeWithText("Held agent").assertIsDisplayed()
            app.onNodeWithContentDescription("Dismiss notification").performClick()
            app.mainClock.advanceTimeBy(400)
            app.runOnIdle { recommended = 12_000 }
            receive(e, event("extended", "Extended agent"))
            app.mainClock.advanceTimeBy(6_500)
            app.onNodeWithText("Extended agent").assertIsDisplayed()
            app.mainClock.advanceTimeBy(5_500)
            app.mainClock.advanceTimeBy(400)
            app.onNodeWithText("Extended agent").assertDoesNotExist()
            assertTrue(timeoutRequests.contains(listOf(6_000L, true, true, true)))
            noNavigationOrRead(e)
        }
    }
}
