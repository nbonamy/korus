package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native control failures: an uncertain goal looks successful, busy mode changes race,
 * a second settings entry bypasses the offered/connected choices, or session actions
 * interrupt working/disconnected sessions. The public engine state/command port is scripted. */
class ComposerControlsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(connected: Boolean = true, busy: Boolean = false, plan: Boolean = false) = json(
        "startup" to "ready", "pairing" to "idle", "connection" to if(connected) "connected" else "reconnecting",
        "laptopId" to "host", "teamId" to "team", "agentId" to "agent", "canSend" to connected,
        "composerTarget" to ConversationTarget("host","local","team","agent","session").toJson(),
        "laptops" to JSONArray().put(json("id" to "host","name" to "Computer")),
        "header" to json("title" to "Agent","status" to "idle"),"goalBusy" to busy,
        "capabilities" to json("goals" to true,"planMode" to true,"reasoningEffort" to true,"serviceTier" to true),
        "composer" to json("modelId" to "model","effort" to "high","serviceTier" to null,"planMode" to plan),
        "models" to JSONArray().put(json("id" to "model","name" to "Model","efforts" to JSONArray(listOf("high","low")),"tiers" to JSONArray().put(json("id" to "priority","name" to "Fast")))),
        "permissions" to json("approvalPreset" to "read-only","presets" to JSONArray(listOf("read-only","full-access")),"modes" to JSONArray()))
    private fun mount(e: NativeEngineFixture, state: JSONObject) {
        app.waitUntil(20_000) { e.model.state.string("startup")=="ready" }; e.state(state)
        app.activityRule.scenario.onActivity { a -> a.setContent { CompanionTheme { CompanionApp(e.model,{},{},{},{},{},{}) } } }
        app.runOnIdle { e.model.activity(true) }
    }
    private fun command(e: NativeEngineFixture, expected: JSONObject) {
        app.waitUntil(5_000) { shape(e.commands().lastOrNull { it.string("type")==expected.string("type") })==shape(expected) }
        assertEquals(shape(expected),shape(e.commands().last { it.string("type")==expected.string("type") }))
    }
    private fun shape(value: Any?): Any? = when(value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { shape(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { shape(value.get(it)) }
        else -> value
    }
    private fun goalState(busy: Boolean, error: Boolean) = state(busy=busy).put("goal",json("objective" to "Finish the release","status" to "active")).put("goalError",error)

    @Test fun uncertainGoalAndBusyStateStayVisibleUntilTheEngineConfirmsTheOutcome() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e,goalState(busy=true,error=true))
            app.onNodeWithText("Goal change couldn’t be confirmed.",substring=true).assertIsDisplayed()
            app.onNodeWithTag("goal-update-pending").assertIsDisplayed()
            app.onNodeWithContentDescription("Clear goal").assertIsNotEnabled()
            app.onNodeWithContentDescription("Add").performClick();app.onNodeWithText("Plan mode").assertIsNotEnabled()
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            e.state(goalState(busy=false,error=false))
            app.onNodeWithText("Goal change couldn’t be confirmed.",substring=true).assertDoesNotExist()
            app.onNodeWithTag("goal-update-pending").assertDoesNotExist()
            app.onNodeWithContentDescription("Edit goal").performClick()
            e.state(goalState(busy=true,error=false))
            app.onNodeWithContentDescription("Exit goal mode").assertIsNotEnabled()
            app.onNodeWithContentDescription("Set goal").assertIsNotEnabled()
            e.state(goalState(busy=false,error=false))
            app.onNodeWithContentDescription("Clear goal").assertIsEnabled().performClick()
            command(e,json("type" to "clearGoal","target" to state().obj("composerTarget")))
        }
    }

    @Test fun messageOptionsPlanChangeExitsGoalModeAndBothModesPreserveTheDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e,state());app.onNodeWithTag("composer").performTextInput("Keep this objective")
            app.onNodeWithContentDescription("Add").performClick();app.onNodeWithText("Goal mode").performClick()
            app.onNodeWithContentDescription("Exit goal mode").assertIsDisplayed()
            app.onNodeWithContentDescription("Add").performClick();app.onNodeWithText("Plan mode").performClick()
            app.onNodeWithContentDescription("Exit goal mode").assertDoesNotExist()
            command(e,json("type" to "composer","change" to json("planMode" to true)))
            e.state(state(plan=true))
            app.onNodeWithContentDescription("Exit plan mode").assertIsDisplayed().performClick()
            command(e,json("type" to "composer","change" to json("planMode" to false)))
            e.state(state());app.onNodeWithTag("composer").assertTextContains("Keep this objective")
            assertTrue(e.commands().none { it.string("type")=="send" })
        }
    }

    @Test fun addPermissionsShowsTheCurrentChoiceAndTracksTheOfferedPermissionCatalog() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e,state());app.onNodeWithContentDescription("Add").performClick();app.onNodeWithText("Permissions").performClick()
            app.onNode(hasText("Read Only") and hasAnyAncestor(isPopup())).assertExists();app.onNodeWithText("Full Access").performClick()
            command(e,json("type" to "approvalPreset","preset" to "full-access"))
            e.state(state().put("permissions",json("permissionMode" to "default","presets" to JSONArray(),"modes" to JSONArray().put(json("id" to "default","label" to "Default")).put(json("id" to "acceptEdits","label" to "Accept edits")))))
            app.onNodeWithContentDescription("Add").performClick();app.onNodeWithText("Permissions").performClick()
            app.onNodeWithText("Read Only").assertDoesNotExist();app.onNodeWithText("Default").assertExists()
            app.onNodeWithText("Accept edits").performClick();command(e,json("type" to "permissionMode","mode" to "acceptEdits"))
        }
    }

    @Test fun messageOptionsCannotBypassDisconnectedComposerAndPermissionControls() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e,state(connected=false));app.onNodeWithTag("composer").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsNotEnabled()
            app.onNodeWithContentDescription("Fast mode").assertIsNotEnabled()
            app.onNodeWithContentDescription("Add").performClick()
            app.onNodeWithText("Plan mode").assertIsNotEnabled()
            app.onNodeWithText("Permissions").assertIsNotEnabled()
            assertTrue(e.commands().none { it.string("type") in listOf("composer","approvalPreset","permissionMode") })
        }
    }

    @Test fun sessionActionsDoNotRestartWorkingSessionsOrActThroughAConnectionOrActionInFlight() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e,state().put("header",json("title" to "Agent","status" to "working")))
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNodeWithText("Restart Session").assertIsNotEnabled();app.onNodeWithText("Close Session").assertIsEnabled()
            e.state(state().put("sessionAction","restart"))
            app.onNodeWithText("Restart Session").assertIsNotEnabled();app.onNodeWithText("Close Session").assertIsNotEnabled()
            e.state(state(connected=false))
            app.onNodeWithText("Restart Session").assertIsNotEnabled();app.onNodeWithText("Close Session").assertIsNotEnabled()
            e.state(state());app.onNodeWithText("Restart Session").assertIsEnabled().performClick()
            command(e,json("type" to "restartSession"))
        }
    }

    @Test fun sheetDismissalCannotInterruptClosingAndDoneCancelsOnlyThePreviewAfterFailure() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            val preview = json("target" to state().obj("composerTarget"), "isLinkedWorktree" to true,
                "branch" to "feature/check", "hasChanges" to true)
            mount(e, state().put("closePreview", preview).put("sessionAction", "close"))
            app.onNodeWithText("Cancel").assertIsDisplayed().assertIsNotEnabled()
            app.onNode(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.Dismiss))
                .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.Dismiss) { it() }
            app.onNodeWithText("Closing session").assertIsDisplayed()
            assertTrue(e.commands().none { it.string("type") == "cancelCloseSession" })
            e.state(state().put("closePreview", preview).put("sessionActionFailed", true))
            app.onNodeWithText("Cancel").assertIsEnabled().performClick()
            command(e, json("type" to "cancelCloseSession"))
            app.onNodeWithText("Close Session").assertDoesNotExist()
            assertTrue(e.commands().none { it.string("type") == "confirmCloseSession" })
        }
    }
}
