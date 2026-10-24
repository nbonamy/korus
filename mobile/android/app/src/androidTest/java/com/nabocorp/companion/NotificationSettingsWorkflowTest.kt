package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*
import org.json.JSONArray

/** A real modal sheet must invoke the Activity's notification action despite its wrapped Context. */
@RunWith(AndroidJUnit4::class)
class NotificationSettingsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun enablingNotificationsFromTheSettingsSheetReachesThePlatformHandler() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(true))
            app.activityRule.scenario.onActivity { activity ->
                engine.model.push.disable()
                activity.setContent { CompanionTheme { CompanionApp(engine.model, activity::enableNotifications, {}, {}, {}, {}, {}) } }
            }
            app.runOnIdle { engine.model.sheet = "settings" }
            app.onNodeWithText("Notifications").performScrollTo().performClick()
            // Verification builds deliberately have no Firebase client configuration.
            app.onNodeWithText("Unavailable").performScrollTo().assertIsDisplayed()
        }
    }

    private fun state(connected: Boolean) = json("startup" to "ready", "pairing" to "idle", "connection" to if (connected) "connected" else "reconnecting",
        "laptopId" to "host", "laptops" to JSONArray().put(json("id" to "host", "name" to "Computer")),
        "teamId" to "team", "agentId" to "agent", "canSend" to connected,
        "header" to json("title" to "Agent", "status" to "idle"),
        "composerTarget" to ConversationTarget("host", "local", "team", "agent", "session").toJson())

    private fun openSettings(engine: NativeEngineFixture, connected: Boolean) {
        app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
        engine.state(state(connected))
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { CompanionTheme { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } }
        }
        app.runOnIdle { engine.model.activity(true); engine.model.editDraft("Keep this draft") }
        app.onNodeWithContentDescription("Open workspace").performClick()
        app.onNodeWithContentDescription("Settings").performClick()
    }

    @Test fun cancellingForgetReturnsToSettingsWithoutLosingPairingOrTheDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            openSettings(engine, true)
            app.onNodeWithText("Connections").performScrollTo().performClick()
            app.onNodeWithText("Current").assertIsDisplayed()
            app.onNodeWithContentDescription("Manage Computer").performClick()
            app.onNodeWithText("Forget connection").performClick()
            app.onNodeWithText("Forget this laptop?").assertIsDisplayed()
            app.onNodeWithText("Cancel").assertIsDisplayed().performClick()
            app.onNodeWithText("Forget this laptop?").assertDoesNotExist()
            app.onNodeWithContentDescription("Back to Settings").performClick()
            app.onNodeWithText("Usage and limits").performScrollTo().assertIsDisplayed()
            app.onNodeWithText("Done").performClick()
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            assertEquals("agent", engine.model.state.string("agentId"))
            assertTrue(engine.commands().none { it.string("type") == "forget" })
        }
    }

    @Test fun connectionsCanSwitchForgetAnInactiveLaptopAndAddAnother() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            openSettings(engine, true)
            val twoLaptops = state(true).put("laptops", JSONArray().put(json("id" to "host", "name" to "Computer")).put(json("id" to "other", "name" to "Travel laptop")))
            engine.state(twoLaptops)
            app.onNodeWithText("Connections").performScrollTo().performClick()
            app.onNodeWithText("Current").assertIsDisplayed()
            app.onNodeWithContentDescription("Manage Travel laptop").performClick()
            app.onNodeWithText("Forget connection").performClick()
            app.onNodeWithText("Forget Laptop").performClick()
            app.waitUntil(5_000) { engine.commands().any { it.string("type") == "forget" && it.string("laptopId") == "other" } }
            assertEquals("connections", engine.model.sheet)
            app.onNodeWithText("Travel laptop").performClick()
            app.waitUntil(5_000) { engine.commands().any { it.string("type") == "connect" && it.string("laptopId") == "other" } }
            app.runOnIdle { engine.model.sheet = "connections" }
            app.onNodeWithText("Add connection").performClick()
            app.waitUntil(5_000) { engine.commands().any { it.string("type") == "chooseConnection" } }
            engine.state(twoLaptops.put("connection", "unpaired").put("laptopId", "").put("teamId", "").put("agentId", ""))
            app.onNodeWithText("Connect your laptop").assertIsDisplayed()
        }
    }

    @Test fun disconnectedComputerCanBeReconnectedFromSettingsWithoutLosingItsDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            openSettings(engine, false)
            app.waitUntil(7_000) { engine.model.showConnectionLost }
            app.onNodeWithText("Connections").performScrollTo().performClick()
            val inSheet = hasAnyAncestor(hasScrollAction())
            app.onNode(hasText("Reconnect") and inSheet).performScrollTo().performClick()
            app.waitUntil(5_000) { engine.commands().any { it.string("type") == "reconnect" } }
            assertEquals("{\"type\":\"reconnect\"}", engine.commands().last { it.string("type") == "reconnect" }.toString())
            engine.state(state(true))
            app.onNode(hasText("Reconnect") and inSheet).assertDoesNotExist()
            app.onNodeWithText("Done").performClick()
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
        }
    }
}
