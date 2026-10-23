package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Native queue actions must carry the captured conversation and wait for authoritative results. */
@RunWith(AndroidJUnit4::class)
class QueuedPromptsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    @Test fun queueControlsUseTheirCapturedTargetAndDisableMutationsWhilePending() {
        val target = mutableStateOf(ConversationTarget("host-a", "local", "team", "agent", "session-a"))
        val pending = mutableStateOf<String?>(null)
        val failed = mutableStateOf(false)
        val prompts = listOf(json("id" to "one", "text" to "Check tests"), json("id" to "two", "text" to "Summarize changes"))
        val sent = mutableListOf<JSONObject>()
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { MaterialTheme { QueuedPromptsContent(prompts, target.value, true, pending.value, failed.value) { sent.add(it); pending.value = it.string("promptId") } } }
        }
        app.onNodeWithText("Queued · 2").assertIsDisplayed()
        app.onNodeWithContentDescription("Steer queued message: Check tests").performClick()
        app.runOnIdle {
            val command = sent.single()
            assertEquals(setOf("type", "target", "promptId", "action"), command.keys().asSequence().toSet())
            assertEquals("queuedPrompt", command.string("type")); assertEquals("one", command.string("promptId")); assertEquals("steer", command.string("action"))
            assertEquals(target.value, ConversationTarget.parse(command.obj("target")))
        }
        app.onNodeWithContentDescription("Delete queued message: Summarize changes").assertIsNotEnabled()
        app.runOnIdle { failed.value = true; pending.value = null; target.value = ConversationTarget("host-b", "remote", "other-team", "agent", "session-b") }
        app.onNodeWithText("Queue change couldn’t be confirmed.", substring = true).assertIsDisplayed()
        app.onNodeWithContentDescription("Delete queued message: Summarize changes").performClick()
        app.runOnIdle {
            assertEquals(2, sent.size)
            assertEquals("delete", sent.last().string("action")); assertEquals("two", sent.last().string("promptId"))
            assertEquals(target.value, ConversationTarget.parse(sent.last().obj("target")))
            assertEquals("host-a", sent.first().obj("target").string("hostId"))
        }
    }
}
