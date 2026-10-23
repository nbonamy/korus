package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Layout changes must retain editor focus/drafts and keep Stop, modes and import failures usable. */
class ComposerPresentationWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(working: Boolean = false, plan: Boolean = false) = json(
        "startup" to "ready", "pairing" to "idle", "connection" to "connected", "canSend" to true,
        "laptopId" to "host", "laptops" to JSONArray().put(json("id" to "host")), "teamId" to "team", "agentId" to "agent",
        "composerTarget" to ConversationTarget("host", "local", "team", "agent", "session").toJson(),
        "header" to json("title" to "Agent", "status" to if (working) "working" else "idle"),
        "capabilities" to json("attachments" to true, "interrupt" to true, "goals" to true, "planMode" to true, "serviceTier" to true),
        "composer" to json("modelId" to "model", "effort" to "medium", "planMode" to plan),
        "models" to JSONArray().put(json("id" to "model", "name" to "Model", "efforts" to JSONArray(listOf("medium")),
            "tiers" to JSONArray().put(json("id" to "priority", "name" to "Fast")))))
    private fun mount(e: NativeEngineFixture, working: Boolean = false) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state(working))
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { CompanionTheme { CompanionApp(e.model, {}, {}, {}, {}, {}, {}) } }
        }
        app.runOnIdle { e.model.activity(true) }
    }

    @Test fun idleComposerExpandsForEditingAndKeepsItsDraftAcrossModelSelectionAndNavigation() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e)
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            app.onNodeWithContentDescription("Send").assertDoesNotExist()
            val editor = app.onNodeWithTag("composer").getUnclippedBoundsInRoot()
            val add = app.onNodeWithContentDescription("Add").getUnclippedBoundsInRoot()
            val mic = app.onNodeWithContentDescription("Dictate").getUnclippedBoundsInRoot()
            assertTrue(add.top < editor.bottom && add.bottom > editor.top && mic.top < editor.bottom && mic.bottom > editor.top)
            app.onNodeWithTag("composer").performClick().performTextInput("Keep this draft")
            app.onNodeWithTag("composer").assertIsFocused().assertTextContains("Keep this draft")
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed().performClick()
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            app.onAllNodesWithContentDescription("Add").assertCountEquals(1)
            app.onAllNodesWithContentDescription("Dictate").assertCountEquals(1)
            app.onNodeWithTag("composer").performTextClearance()
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithContentDescription("Close navigation menu").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            assertTrue(e.commands().none { it.string("type") == "send" })
        }
    }

    @Test fun compactWorkingComposerRetainsStopAndTypingMovesControlsWithoutLosingFocus() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, working = true)
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            app.onNodeWithContentDescription("Stop").assertIsDisplayed().performClick()
            app.waitUntil(5_000) { e.commands().any { it.string("type") == "interrupt" } }
            assertEquals("{\"type\":\"interrupt\"}", e.commands().last { it.string("type") == "interrupt" }.toString())
            app.onNodeWithTag("composer").performTextInput("Next instruction")
            app.onNodeWithTag("composer").assertIsFocused().assertTextContains("Next instruction")
            app.onNodeWithContentDescription("Stop").assertDoesNotExist()
            app.onNode(hasContentDescription("Steer agent") or hasContentDescription("Queue message")).assertIsEnabled()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed()
            app.onAllNodesWithContentDescription("Add").assertCountEquals(1)
        }
    }

    @Test fun emptyImportFailureAndGoalOrPlanModeKeepTheFullComposerAvailable() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e)
            val request = app.runOnIdle { e.model.composerDrafts.beginImport()!! }
            app.onNodeWithText("Preparing attachments…").assertIsDisplayed()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed()
            app.runOnIdle { e.model.composerDrafts.finishImport(request, emptyList(), "Import failed") }
            app.onNodeWithText("Import failed").assertIsDisplayed()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed()
            app.onNodeWithContentDescription("Dismiss attachment message").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            app.onNodeWithContentDescription("Add").performClick(); app.onNodeWithText("Goal mode").performClick()
            app.onNodeWithContentDescription("Exit goal mode").assertIsDisplayed()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed()
            app.onNodeWithContentDescription("Exit goal mode").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            e.state(state(plan = true))
            app.onNodeWithContentDescription("Exit plan mode").assertIsDisplayed()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsDisplayed()
            app.onNodeWithContentDescription("Exit plan mode").performClick(); e.state(state())
            app.onNodeWithContentDescription("Choose model and reasoning").assertDoesNotExist()
            assertTrue(e.commands().none { it.string("type") == "send" })
        }
    }
}
