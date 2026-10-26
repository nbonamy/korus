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
    private val ticket = json("number" to 2, "title" to "Open workers", "state" to "running", "agentId" to "worker", "activity" to "Implement ticket 2")
    private val mission = json("id" to "m", "outcome" to "Follow missions on the phone", "stage" to "implementation", "status" to "active", "done" to 1, "leadAgentId" to "lead",
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
            app.onNodeWithText("Talk to the mission lead").assertIsDisplayed()
            app.onNodeWithText("In progress").assertIsDisplayed()
            app.onNodeWithText("Implement ticket 2").assertDoesNotExist()
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
            // A conversation carries no mission progress.
            app.onNodeWithText("Mission · ticket 2 of 2 · In progress").assertDoesNotExist()
            app.onNodeWithContentDescription("Back to mission").performClick()
            app.onNodeWithText("TICKETS").assertIsDisplayed()
            app.onNodeWithText("02 Open workers").assertIsDisplayed()
        }
    }

    @Test fun aFinishedMissionContinuesToReviewAfterConfirmationAndShipIsDesktopOnly() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            val done = JSONObject(mission.toString()).put("done", 2).put("next", "review").put("revision", 4)
            mount(e, state().put("missions", JSONArray().put(done)))
            e.model.showMissions("m")
            app.onNodeWithText("Continue to Review").performClick()
            app.onNodeWithText("Move this mission to review?").assertIsDisplayed()
            app.onAllNodesWithText("Continue to Review").onLast().performClick()
            app.waitUntil(5_000) { e.commands().lastOrNull()?.let { it.string("type") == "continueMission" && it.string("missionId") == "m" } == true }
            e.state(state().put("missions", JSONArray().put(JSONObject(done.toString()).put("stage", "review").put("next", "ship"))))
            app.onNodeWithText("Only available on desktop").assertIsDisplayed()
            app.onNodeWithText("Continue to Review").assertDoesNotExist()
        }
    }

    @Test fun aReviewListsItsFindingsAndFixesTheSelectedOnesAfterConfirmation() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            fun finding(id: String, state: String, selected: Boolean) = json("id" to id, "priority" to "p1", "title" to "Finding $id", "body" to "Why $id matters.", "repository" to "korus",
                "file" to "auth/session.ts", "line" to 142, "selected" to selected, "state" to state)
            val reviewed = JSONObject(mission.toString()).put("stage", "review").put("done", 2).put("revision", 4)
                .put("review", json("summary" to "Two issues", "findings" to JSONArray().put(finding("a", "open", true)).put(finding("b", "fixed", false))))
            mount(e, state().put("missions", JSONArray().put(reviewed)))
            e.model.showMissions("m")
            app.onNodeWithText("1 finding").assertDoesNotExist()
            app.onNodeWithText("2 findings · 1 fixed").performClick()
            app.onNodeWithText("Fix 1 selected").assertIsDisplayed()
            app.onNodeWithContentDescription("Deselect Finding a").performClick()
            app.waitUntil(5_000) { e.commands().lastOrNull()?.let { it.string("type") == "selectFinding" && it.string("findingId") == "a" && !it.optBoolean("selected") } == true }
            app.onNodeWithText("Fix 1 selected").performClick()
            app.onNodeWithText("The other open findings are skipped.").assertIsDisplayed()
            app.onNodeWithText("Fix selected").performClick()
            app.waitUntil(5_000) { e.commands().lastOrNull()?.string("type") == "fixFindings" }
            app.onNodeWithText("Finding a").performClick()
            app.onNodeWithText("Why a matters.").assertIsDisplayed()
        }
    }
}
