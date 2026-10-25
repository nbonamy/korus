package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Mission regressions: missions are unreachable from the drawer, a ticket does not open its worker,
 * the worker can be typed into, or there is no way back to the mission. */
class MissionsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private val ticket = json("number" to 2, "title" to "Open workers", "state" to "running", "agentId" to "worker")
    private val mission = json("id" to "m", "outcome" to "Follow missions on the phone", "stage" to "implementation", "status" to "active", "done" to 1,
        "tickets" to JSONArray().put(json("number" to 1, "title" to "Project missions", "state" to "accepted")).put(ticket))
    private fun state(agentId: String = "agent", worker: Boolean = false) = json(
        "startup" to "ready", "connection" to "connected", "laptopId" to "host", "teamId" to "team", "agentId" to agentId, "canSend" to true,
        "composerTarget" to ConversationTarget("host", "local", "team", agentId, "session").toJson(),
        "laptops" to JSONArray().put(json("id" to "host")), "teams" to JSONArray().put(json("id" to "team", "name" to "Team")),
        "missions" to JSONArray().put(mission), "mission" to if (worker) json("id" to "m", "outcome" to "Follow missions on the phone") else JSONObject.NULL,
        "header" to json("title" to if (worker) "Open workers" else "Build agent", "repository" to "", "status" to "working", "statusText" to "Working"),
        "git" to json("available" to false))
    private fun mount(e: NativeEngineFixture, state: JSONObject) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state)
        app.activityRule.scenario.onActivity { activity -> activity.setContent { CompanionTheme { CompanionApp(e.model, {}, {}, {}, {}, {}, {}) } } }
        app.runOnIdle { e.model.activity(true) }
    }

    @Test fun missionsOpenFromTheDrawerAndATicketOpensItsWorker() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state())
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithContentDescription("Missions, 1 active").performClick()
            // The card says what an agent is on right now.
            app.onNodeWithText("02 Open workers").assertIsDisplayed()
            app.onNodeWithText("Follow missions on the phone").performClick()
            app.onNodeWithText("1 of 2 tickets").assertIsDisplayed()
            app.onNodeWithText("02 Open workers").performClick()
            app.waitUntil(5_000) { e.commands().lastOrNull()?.let { it.string("type") == "selectAgent" && it.string("id") == "worker" } == true }
            app.onNodeWithText("TICKETS").assertDoesNotExist()
        }
    }

    @Test fun aWorkerShowsItsMissionContextAndLeadsBackToIt() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state(agentId = "worker", worker = true))
            app.onNodeWithContentDescription("Conversation actions").assertDoesNotExist()
            app.onNodeWithContentDescription("Open workspace").assertDoesNotExist()
            app.onNodeWithText("Mission · ticket 2 of 2 · In progress").assertIsDisplayed()
            app.onNodeWithContentDescription("Back to mission").performClick()
            app.onNodeWithText("TICKETS").assertIsDisplayed()
            app.onNodeWithText("02 Open workers").assertIsDisplayed()
        }
    }
}
