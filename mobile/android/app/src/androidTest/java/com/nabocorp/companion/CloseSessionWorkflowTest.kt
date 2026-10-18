package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A dirty worktree requires explicit consent; the action retains the preview's captured agent. */
@RunWith(AndroidJUnit4::class)
class CloseSessionWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun preview(agent: String = "first") = json("target" to json("hostId" to "host", "locationId" to "local", "teamId" to "team", "agentId" to agent, "sessionId" to "session"),
        "isLinkedWorktree" to true, "branch" to "feature/native", "upstream" to "origin/feature/native", "hasChanges" to true)
    private fun JSONObject.fields() = keys().asSequence().associateWith { get(it) }

    @Test fun dirtyWorktreeDeletionRequiresConsentAndChangingPreviewResetsIt() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            fun state(agent: String = "first", busy: Boolean = false, failed: Boolean = false) = json("startup" to "ready", "agentId" to agent,
                "closePreview" to preview(agent), "sessionAction" to if (busy) "close" else null, "sessionActionFailed" to failed)
            app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { SheetContent(engine.model, {}, {}) } } }
            engine.state(state())
            app.onNodeWithText("Close Session").assertIsDisplayed()
            app.onNodeWithText("Delete Worktree and Close").assertIsNotEnabled()
            app.onNodeWithText("Discard uncommitted changes").performClick()
            app.onNodeWithText("Also delete origin/feature/native").performClick()
            app.onNodeWithText("Delete Worktree and Close").performClick()
            assertEquals(mapOf("type" to "confirmCloseSession", "agentId" to "first", "deleteWorktree" to true, "deleteRemoteBranch" to true, "discardChanges" to true), engine.commands().single().fields())
            engine.state(state("second"))
            app.onNodeWithText("Delete Worktree and Close").assertIsNotEnabled()
            app.onNodeWithText("Keep Worktree and Close").performClick()
            assertEquals(mapOf("type" to "confirmCloseSession", "agentId" to "second", "deleteWorktree" to false), engine.commands().last().fields())
            engine.state(state("second", busy = true))
            app.onNodeWithText("Keep Worktree and Close").assertDoesNotExist()
            app.onNodeWithText("Closing session…").assertIsDisplayed()
            engine.state(state("second", failed = true))
            app.onNodeWithText("Couldn’t close this session.", substring = true).assertIsDisplayed()
            app.onNodeWithText("Keep Worktree and Close").assertIsEnabled()
            app.onNodeWithText("Cancel").performScrollTo().assertIsDisplayed().performClick()
            assertEquals(mapOf("type" to "cancelCloseSession"), engine.commands().last().fields())
        }
    }
}
