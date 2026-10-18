package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Failure modes: partials duplicate words, silence loses completed speech, stopping drops final
 * words, late permission/recognition changes another host's draft, or hidden UI keeps recording.
 * The OS speech/permission boundary is substituted; the real composer, model and engine port run. */
class DictationWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(host: String = "host") = ConversationTarget(host, "local", "team", "agent", "session")
    private fun state(target: ConversationTarget = target()) = json("startup" to "ready", "connection" to "connected", "agentId" to target.agentId,
        "composerTarget" to target.toJson(), "canSend" to true, "capabilities" to json("attachments" to true, "goals" to true))

    private fun mount(engine: NativeEngineFixture, capture: Capture, permission: ((Boolean) -> Unit) -> Unit = { it(true) }) {
        app.activityRule.scenario.onActivity { activity ->
            engine.model.activity(true)
            activity.setContent { MaterialTheme { Composer(engine.model, {}, { engine.model.toggleDictation(capture, permission) }) } }
        }
    }

    @Test fun partialRevisionsAndUtterancesAppendToTheDraftAndStopKeepsFinalWords() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            val capture = Capture()
            mount(engine, capture)
            app.onNodeWithTag("composer").performTextInput("My notes:")
            app.onNodeWithContentDescription("Dictate").performClick()
            app.onNodeWithTag("composer").assertIsNotEnabled()
            app.onNodeWithContentDescription("Add").performClick()
            app.onNodeWithText("Add Photos").assertIsNotEnabled()
            app.onNodeWithText("Goal mode").assertIsNotEnabled()
            // Back closes the real dropdown without changing recording ownership.
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            val first = capture.sessions.single()
            app.runOnIdle { first.update("First"); first.update("First thought.") }
            app.onNodeWithTag("composer").assertTextEquals("My notes: First thought.")
            app.runOnIdle { first.complete(null) }
            app.onNodeWithContentDescription("Stop dictation").assertIsEnabled()
            app.runOnIdle {
                first.update("Stale result"); first.complete("Stale failure")
                capture.sessions.last().update("Another thought")
            }
            app.onNodeWithTag("composer").assertTextEquals("My notes: First thought. Another thought")
            app.onNodeWithContentDescription("Stop dictation").performClick()
            app.runOnIdle { assertTrue(capture.stopped); capture.sessions.last().update("Another thought."); capture.sessions.last().complete(null) }
            app.onNodeWithContentDescription("Dictate").assertIsEnabled()
            app.onNodeWithTag("composer").assertIsEnabled().assertTextEquals("My notes: First thought. Another thought.")
            app.onNodeWithContentDescription("Dictate").performClick()
            val sending = capture.sessions.last()
            app.runOnIdle { sending.update("Send this") }
            app.onNodeWithContentDescription("Send").performClick()
            app.runOnIdle { sending.update("Late words"); sending.complete(null) }
            val command = engine.commands().single { it.string("type") == "send" }
            assertEquals("My notes: First thought. Another thought. Send this", command.string("text"))
            assertEquals(target(), ConversationTarget.parse(command.obj("target")))
            assertEquals(command.string("text"), engine.model.draft)
            app.runOnIdle { assertFalse(engine.model.dictation.active); assertFalse(capture.recording) }
        }
    }

    @Test fun delayedPermissionAndRecognitionCannotFollowNavigationBackgroundLockOrNativeSheets() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            val capture = Capture()
            lateinit var permission: (Boolean) -> Unit
            mount(engine, capture) { permission = it }
            app.onNodeWithTag("composer").performTextInput("Original")
            app.onNodeWithContentDescription("Dictate").performClick()
            engine.state(state(target("other-host")))
            app.runOnIdle { permission(true); assertTrue(capture.sessions.isEmpty()) }
            app.onNodeWithContentDescription("Dictate").assertIsEnabled()
            app.onNodeWithTag("composer").performTextInput("Other host")
            engine.state(state())
            app.onNodeWithTag("composer").assertTextEquals("Original")
            app.onNodeWithContentDescription("Dictate").performClick()
            app.runOnIdle { permission(true); capture.sessions.last().update("words") }
            val departed = capture.sessions.last()
            engine.state(state(target("other-host")))
            app.runOnIdle { departed.update("Wrong host"); departed.complete(null) }
            app.onNodeWithTag("composer").assertTextEquals("Other host")
            engine.state(state())
            app.onNodeWithTag("composer").assertTextEquals("Original words")
            val interruptions: List<(CompanionModel) -> Unit> = listOf({ it.activity(false) }, { it.setUnlocked(false) }, { it.sheet = "models" }, { it.drawerVisible = true })
            interruptions.forEach { interrupt ->
                app.onNodeWithContentDescription("Dictate").performClick()
                app.runOnIdle {
                    permission(true)
                    val session = capture.sessions.last()
                    interrupt(engine.model)
                    assertFalse(engine.model.dictation.active)
                    assertFalse(capture.recording)
                    session.update("Must be ignored"); session.complete("Must be ignored")
                    permission(false) // Repeated permission results cannot revive a canceled request.
                    engine.model.activity(true); engine.model.setUnlocked(true); engine.model.sheet = null; engine.model.drawerVisible = false
                }
                app.onNodeWithTag("composer").assertTextEquals("Original words")
                app.onNodeWithText("Dictation unavailable").assertDoesNotExist()
            }
        }
    }

    @Test fun permissionFailureUnavailableServiceAndFinishTimeoutKeepTheDraftAndAllowRetry() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            val capture = Capture()
            var allowed = false
            var permissions = 0
            mount(engine, capture) { permissions++; it(allowed) }
            app.onNodeWithTag("composer").performTextInput("Keep this")
            app.onNodeWithContentDescription("Dictate").performClick()
            app.onNodeWithText("Dictation unavailable").assertIsDisplayed()
            app.onNodeWithText("OK").performClick()
            app.onNodeWithTag("composer").assertTextEquals("Keep this")
            app.runOnIdle { capture.available = false }
            app.onNodeWithContentDescription("Dictate").performClick()
            app.onNodeWithText("On-device dictation", substring = true).assertIsDisplayed()
            app.onNodeWithText("OK").performClick()
            assertEquals(1, permissions)
            app.runOnIdle { capture.available = true; allowed = true }
            app.onNodeWithContentDescription("Dictate").performClick()
            app.runOnIdle { capture.sessions.last().update("latest words") }
            app.onNodeWithContentDescription("Stop dictation").performClick()
            app.waitUntil(5000) { !engine.model.dictation.active }
            app.onNodeWithTag("composer").assertIsEnabled().assertTextEquals("Keep this latest words")
            app.onNodeWithContentDescription("Dictate").performClick()
            app.runOnIdle { capture.sessions.last().complete("Microphone interrupted. Your words are kept in the draft.") }
            app.onNodeWithText("Dictation unavailable").assertIsDisplayed()
            app.onNodeWithText("OK").performClick()
            app.onNodeWithTag("composer").assertTextEquals("Keep this latest words")
        }
    }

    @Test fun aRecognizerThatNeverBecomesReadyReleasesTheEditorWithItsDraftIntact() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            val capture = Capture().apply { becomesReady = false }
            mount(engine, capture)
            app.onNodeWithTag("composer").performTextInput("Unsent words")
            app.onNodeWithContentDescription("Dictate").performClick()
            app.onNodeWithTag("composer").assertIsNotEnabled()
            val accessibility = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
            app.waitUntil(2000) { hasDescription(accessibility.rootInActiveWindow, "Stop dictation") }
            app.waitUntil(12_000) { !engine.model.dictation.active }
            app.onNodeWithText("Dictation unavailable").assertIsDisplayed()
            app.onNodeWithText("OK").performClick()
            app.onNodeWithTag("composer").assertIsEnabled().assertTextEquals("Unsent words")
            app.runOnIdle { assertFalse(capture.recording); capture.becomesReady = true }
            app.onNodeWithContentDescription("Dictate").performClick()
            app.runOnIdle { capture.sessions.last().update("after retry") }
            app.onNodeWithTag("composer").assertTextEquals("Unsent words after retry")
        }
    }

    private fun hasDescription(node: android.view.accessibility.AccessibilityNodeInfo?, text: String): Boolean = node != null &&
        (node.contentDescription?.toString() == text || (0 until node.childCount).any { hasDescription(node.getChild(it), text) })

    private class Capture : DictationCapture {
        data class Session(val update: (String) -> Unit, val complete: (String?) -> Unit)
        var available = true
        var becomesReady = true
        override val isAvailable get() = available
        val sessions = mutableListOf<Session>()
        var stopped = false
        var recording = false
        override fun start(ready: () -> Unit, update: (String) -> Unit, complete: (String?) -> Unit) {
            recording = becomesReady; stopped = false; sessions.add(Session(update, complete))
            if (becomesReady) ready()
        }
        override fun finish() { stopped = true; recording = false }
        override fun cancel() { recording = false }
    }
}
