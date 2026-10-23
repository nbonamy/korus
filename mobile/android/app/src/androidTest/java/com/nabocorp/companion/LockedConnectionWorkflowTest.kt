package com.nabocorp.companion

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** The native lock boundary must stop connection/read signals and defer captured notification taps. */
class LockedConnectionWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun lockedScreenCannotConnectOrReadAndNotificationNavigationWaitsForUnlock() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val target = ConversationTarget("host", "local", "team", "agent", "session")
            engine.state(json("startup" to "ready", "connection" to "connected", "conversationReady" to true, "agentId" to "agent", "conversationGeneration" to 7, "composerTarget" to target.toJson()))
            app.runOnIdle { engine.model.setUnlocked(false); engine.model.activity(true) }
            app.activityRule.scenario.onActivity {
                val event = json("channel" to "transcript", "message" to json("type" to "rendered", "receipt" to json("agentId" to "agent", "generation" to 7, "revision" to 4)))
                engine.model.transcript.view.evaluateJavascript("companionNative.postMessage(${org.json.JSONObject.quote(event.toString())})", null)
            }
            app.waitUntil(5000) { engine.model.renderedAgent == "agent" }
            assertFalse(engine.commands().any { it.string("type") == "read" || it.string("type") == "activity" && it.optBoolean("active") })
            app.runOnIdle { assertNull(engine.model.attention.visibleTarget); engine.model.setUnlocked(true) }
            app.waitUntil(5000) { engine.model.attention.visibleTarget == target }
            assertEquals(4, engine.commands().single { it.string("type") == "read" }.getInt("revision"))
            app.runOnIdle {
                engine.model.setUnlocked(false)
                val event = json("id" to "locked-tap", "name" to "Private agent", "kind" to "question", "createdAt" to System.currentTimeMillis(), "target" to target.copy(agentId = "other").toJson())
                engine.model.attention.receive(event.toString())
                assertNull(engine.model.attention.current)
                engine.model.attention.tapped(event.toString())
            }
            assertFalse(engine.commands().any { it.string("type") == "openNotification" })
            app.runOnIdle { engine.model.setUnlocked(true) }
            val commands = engine.commands()
            assertEquals(target.copy(agentId = "other"), ConversationTarget.parse(commands.single { it.string("type") == "openNotification" }.obj("target")))
            assertEquals("activity", commands.last().string("type"))
            assertTrue(commands.last().getBoolean("active"))
            assertEquals(1, commands.count { it.string("type") == "read" })
        }
    }
}
