package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Header regressions: repository metadata hides status, unread work has no entry-point
 * cue, session actions obscure the whole conversation, or a failed ordinary close is silent. */
class ConversationHeaderWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(status: String = "working", statusText: String = "Working", repository: String = "fixture", unread: Boolean = true, dirty: Boolean = true) = json(
        "startup" to "ready", "connection" to "connected", "laptopId" to "host", "teamId" to "team", "agentId" to "agent", "canSend" to true,
        "composerTarget" to ConversationTarget("host", "local", "team", "agent", "session").toJson(),
        "laptops" to JSONArray().put(json("id" to "host")),
        "teams" to JSONArray().put(json("id" to "team", "name" to "Team")).put(json("id" to "other", "name" to "Other", "isUnread" to unread)),
        "header" to json("title" to "Build agent", "repository" to repository, "status" to status, "statusText" to statusText),
        "git" to json("available" to true, "uncommitted" to json("state" to if (dirty) "dirty" else "clean")))
    private fun mount(e: NativeEngineFixture, state: JSONObject) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state)
        app.activityRule.scenario.onActivity { activity -> activity.setContent { CompanionTheme { CompanionApp(e.model, {}, {}, {}, {}, {}, {}) } } }
        app.runOnIdle { e.model.activity(true) }
    }
    private fun assertCommand(e: NativeEngineFixture, expected: JSONObject) {
        fun fields(value: JSONObject) = value.keys().asSequence().associateWith { value.get(it) }
        app.waitUntil(5_000) { e.commands().lastOrNull()?.let(::fields) == fields(expected) }
        assertEquals(fields(expected), fields(e.commands().last()))
    }

    @Test fun centeredHeaderRetainsRepositoryAndStatusAndUpdatesWorkspaceAndDirtyCues() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state())
            app.onNodeWithText("fixture · Working").assertIsDisplayed()
            val title = app.onNodeWithText("Build agent").getUnclippedBoundsInRoot()
            val root = app.onRoot().getUnclippedBoundsInRoot()
            assertEquals((root.left.value + root.right.value) / 2, (title.left.value + title.right.value) / 2, 1f)
            app.onNodeWithContentDescription("Open workspace").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Unread activity"))
            app.onNodeWithContentDescription("Conversation actions").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Uncommitted changes"))
            e.state(state(status = "error", statusText = "Failed", unread = false, dirty = false))
            app.onNodeWithText("fixture · Failed").assertIsDisplayed()
            app.onNodeWithContentDescription("Open workspace").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ""))
            app.onNodeWithContentDescription("Conversation actions").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ""))
            e.state(state(status = "awaitingInput", statusText = "Waiting for input", repository = ""))
            app.onNodeWithText("Waiting for input").assertIsDisplayed()
            e.state(state(status = "idle", statusText = ""))
            app.onNodeWithText("fixture").assertIsDisplayed()
            app.onNodeWithText("Waiting for input").assertDoesNotExist()
            e.state(state().put("header", JSONObject.NULL))
            app.onNodeWithText(e.model.product.string("name")).assertIsDisplayed()
        }
    }

    @Test fun sessionActionsUseAPopupAndClosePreparationGuardsRepeatedActions() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state(status = "idle", statusText = "", dirty = false).put("git", json("available" to false)))
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNode(hasText("Restart session") and hasAnyAncestor(isPopup())).assertIsDisplayed()
            app.onNodeWithText("Changes").assertDoesNotExist()
            e.state(state(status = "idle").put("sessionAction", "previewClose"))
            app.onNodeWithContentDescription("Conversation actions").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Uncommitted changes, Preparing to close session"))
            app.onNodeWithText("Restart session").assertIsNotEnabled()
            app.onNodeWithText("Close session").assertIsNotEnabled()
            app.onNodeWithText("Changes").assertIsNotEnabled()
            e.state(state(status = "idle", statusText = "", dirty = false))
            app.onNodeWithText("Close session").performClick()
            assertCommand(e, json("type" to "closeSession"))
            app.onNodeWithText("Close session").assertDoesNotExist()
        }
    }

    @Test fun sessionFailureIsAcknowledgedWithoutLosingTheDraftAndLinkedWorktreeErrorsStayInTheirConsentSheet() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state(status = "idle"))
            app.onNodeWithTag("composer").performTextInput("Keep this draft")
            for (preview in listOf<JSONObject?>(null, json("target" to e.model.state.obj("composerTarget"), "isLinkedWorktree" to false))) {
                e.state(state(status = "idle").put("sessionActionFailed", true).put("closePreview", preview ?: JSONObject.NULL))
                app.onNodeWithText("Session action failed").assertIsDisplayed()
                app.onNodeWithText("OK").performClick()
                assertCommand(e, json("type" to "dismissSessionError"))
                e.state(state(status = "idle"))
                app.onNodeWithText("Session action failed").assertDoesNotExist()
                app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            }
            val linked = json("target" to e.model.state.obj("composerTarget"), "isLinkedWorktree" to true, "branch" to "feature/native", "hasChanges" to true)
            e.state(state(status = "idle").put("sessionActionFailed", true).put("closePreview", linked))
            app.onNodeWithText("Session action failed").assertDoesNotExist()
            app.onNodeWithText("Couldn’t close this session.", substring = true).assertIsDisplayed()
            app.onNodeWithText("Delete Worktree and Close").assertIsNotEnabled()
            assertTrue(e.commands().none { it.string("type") in listOf("send", "confirmCloseSession") })
        }
    }
}
