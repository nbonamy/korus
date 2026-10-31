package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native workflow failure modes: implicit automation/commits, wrong scope/model/target,
 * duplicate starts after an uncertain receipt, lost draft on Back, or stale review across hosts.
 * The public engine port remains the only substituted boundary. */
class ReviewWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(host: String = "host") = ConversationTarget(host, "local", "team", "agent", "session")
    private fun setup(host: String = "host", backend: String = "codex", current: Boolean = true, active: Boolean = false, changes: Boolean = true) = json(
        "target" to target(host).toJson(), "branch" to "feature/native", "baseRef" to "main", "uncommitted" to changes,
        "branchChanges" to changes, "currentThread" to current, "activeReview" to active, "reviewerAgentId" to if (active) "reviewer" else null,
        "agentBackend" to "codex", "backend" to backend, "backends" to JSONArray(listOf("codex", "claude")),
        "models" to JSONArray().put(json("id" to "$backend-review", "name" to "Review model", "efforts" to JSONArray(listOf("high", "low")), "tiers" to JSONArray().put(json("id" to "fast", "name" to "Fast")))),
        "preferences" to json("providers" to json(backend to json("model" to "$backend-review", "reasoningEffort" to "high"))))
    private fun state(status: String = "ready", setup: JSONObject? = setup(), host: String = "host", connected: Boolean = true) = json(
        "startup" to "ready", "conversationReady" to true, "connection" to if (connected) "connected" else "reconnecting", "agentId" to "agent", "composerTarget" to target(host).toJson(),
        "laptops" to JSONArray().put(json("id" to host, "name" to "Computer")), "canSend" to connected, "capabilities" to json(),
        "header" to json("title" to "My agent"), "review" to json("status" to status, "setup" to setup))
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } } }
    }
    private fun openReview() {
        app.onNodeWithContentDescription("Add").performClick()
        app.onNodeWithText("Review").performClick()
        app.onNodeWithText("Review Changes").assertIsDisplayed()
    }
    private fun reveal(matcher: SemanticsMatcher): SemanticsNodeInteraction {
        app.onNodeWithTag("review-form").performScrollToNode(matcher)
        return app.onNode(matcher)
    }
    private fun hideKeyboard() {
        app.runOnIdle { app.activity.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(app.activity.window.decorView.windowToken, 0) }
        app.waitUntil(5000) { ViewCompat.getRootWindowInsets(app.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) != true }
    }
    private fun tree(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { tree(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { tree(value.get(it)) }
        else -> value
    }

    @Test fun findingsCanBeReadSelectedRemediatedAndReviewedAgain() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val finding = json("id" to "finding", "roundId" to "round", "priority" to "p1", "title" to "Preserve the draft",
                "body" to "A reconnect must keep the unfinished message.", "decision" to json("state" to "undecided"),
                "remediation" to json("state" to "notStarted"), "discussion" to JSONArray())
            val round = json("id" to "round", "number" to 1, "status" to "reviewing", "findings" to JSONArray().put(finding))
            val session = json("id" to "review", "activeRoundId" to "round", "updatedAt" to "v1", "status" to "reviewing", "busy" to false,
                "targetAgentId" to "agent", "reviewerAgentId" to "reviewer", "rounds" to JSONArray().put(round))
            fun update(action: String = "idle", connected: Boolean = true) {
                val next = state(setup = setup(active = true), connected = connected).put("reviewFindingsCount", 1)
                next.obj("review").put("details", json("target" to target().toJson(), "session" to session)).put("action", action)
                engine.state(next)
            }
            update(); mount(engine)
            app.onNodeWithText("Review findings · 1").assertIsDisplayed().performClick()
            app.onNodeWithText("Review Changes").assertIsDisplayed()
            app.onNodeWithText("Preserve the draft").performClick()
            app.onNodeWithText("A reconnect must keep the unfinished message.").assertIsDisplayed()
            app.onNodeWithContentDescription("Select Preserve the draft").assertIsNotEnabled()
            session.put("status", "ready"); round.put("status", "ready"); update()
            app.onNodeWithContentDescription("Select Preserve the draft").performClick()
            assertEquals("decide", engine.commands().last { it.string("type") == "reviewAction" }.obj("input").string("action"))
            finding.put("decision", json("state" to "rejected")); update()
            app.onNodeWithText("Complete round").performClick()
            app.onNodeWithText("Complete round", useUnmergedTree = true).assertExists()
            app.onNodeWithText("Confirm").performClick()
            assertEquals("submit", engine.commands().last { it.string("type") == "reviewAction" }.obj("input").string("action"))
            update("unknown")
            app.onNodeWithText("Refresh status").assertIsDisplayed().performClick()
            assertEquals("loadReviewDetails", engine.commands().last().string("type"))
            session.put("status", "readyToFinish"); round.put("status", "completed"); finding.put("remediation", json("state" to "skipped")); update()
            app.onNodeWithText("Review again").performClick()
            // A desktop update while the confirmation is open must not authorize a newer revision.
            session.put("updatedAt", "v2"); update()
            app.onNodeWithText("Confirm").performClick()
            val input = engine.commands().last { it.string("type") == "reviewAction" }.obj("input")
            assertEquals(tree(json("sessionId" to "review", "roundId" to "round", "updatedAt" to "v1", "action" to "again")), tree(input))
            val next = state(setup = setup(active = true))
            next.put("composerTarget", ConversationTarget("host", "local", "team", "agent", "next-session").toJson())
            next.obj("review").put("details", json("target" to next.obj("composerTarget"), "session" to session)).put("action", "idle")
            engine.state(next)
            app.onNodeWithText("Finish review").assertIsDisplayed()
            next.put("connection", "reconnecting"); engine.state(next)
            app.onNodeWithText("Finish review").assertIsNotEnabled()
        }
    }

    @Test fun reviewFormPreservesDraftAndRequiresExplicitAutomationAndCommitConsent() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            app.onNodeWithTag("composer").performTextInput("Keep this draft")
            openReview()
            app.runOnIdle { engine.model.activity(true) }
            app.activityRule.scenario.onActivity {
                val event = json("channel" to "transcript", "message" to json("type" to "rendered", "receipt" to json("agentId" to "agent", "generation" to 0, "revision" to 4)))
                engine.model.transcript.view.evaluateJavascript("companionNative.postMessage(${JSONObject.quote(event.toString())})", null)
            }
            app.waitUntil(5000) { engine.model.renderedAgent == "agent" }
            assertNull(engine.model.attention.visibleTarget)
            assertTrue(engine.commands().none { it.string("type") == "read" })
            assertEquals(1, engine.commands().count { it.string("type") == "loadReview" })
            assertTrue(engine.commands().none { it.string("type") == "review" })
            reveal(hasContentDescription("Reviewer service tier")).performClick()
            app.onNodeWithText("Fast").performClick()
            app.onNodeWithText("Uncommitted Changes").assertIsSelected()
            reveal(hasText("Current Branch")).performClick()
            reveal(hasText("Current Conversation")).performClick()
            reveal(hasText("Automatic Review")).performClick()
            reveal(hasText("Current Conversation")).assertIsNotEnabled()
            reveal(hasText("Independent Reviewer")).assertIsSelected()
            reveal(hasTestTag("review-instructions")).performTextInput("  Check retries  ")
            app.waitUntil(5000) { ViewCompat.getRootWindowInsets(app.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true }
            // The scroll viewport must fill the space above the action, without a second keyboard-sized gap.
            app.waitUntil(5000) {
                val form = app.onNodeWithTag("review-form").getUnclippedBoundsInRoot()
                val action = app.onNodeWithText("Start Review").getUnclippedBoundsInRoot()
                action.top - form.bottom <= 32.dp
            }
            hideKeyboard()
            app.activityRule.scenario.recreate(); mount(engine)
            reveal(hasTestTag("review-instructions")).assertTextContains("  Check retries  ")
            reveal(hasText("Commit Fixes Automatically")).assertIsOff().performClick()
            reveal(hasContentDescription("Fix findings priority")).performClick()
            app.onNodeWithText("High and above (P1)").performClick()
            reveal(hasContentDescription("Increase maximum rounds")).performClick()
            app.onNodeWithText("Start Review").performClick()
            assertEquals(tree(json("type" to "review", "target" to target().toJson(), "input" to json(
                "scope" to json("type" to "branch", "baseRef" to "main"), "threadMode" to "independent", "selection" to json("backend" to "codex", "model" to "codex-review", "reasoningEffort" to "high", "serviceTier" to "fast"), "instructions" to "Check retries",
                "automation" to json("enabled" to true, "maxPriority" to "p1", "maxRounds" to 4, "autoCommit" to true)))),
                tree(engine.commands().single { it.string("type") == "review" }))
            engine.state(state("starting"))
            app.onNodeWithText("Starting your review").assertIsDisplayed()
            app.onNodeWithContentDescription("Back to conversation").assertDoesNotExist()
            engine.state(state("started"))
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            app.waitUntil(5000) { engine.model.attention.visibleTarget == target() }
            assertEquals(4, engine.commands().last { it.string("type") == "read" }.getInt("revision"))
        }
    }

    @Test fun currentConversationOmitsIndependentModelAndBackDoesNotSendAnything() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine); openReview()
            reveal(hasText("Automatic Review")).performClick()
            reveal(hasText("Commit Fixes Automatically")).performClick()
            reveal(hasText("Automatic Review")).performClick()
            reveal(hasText("Current Conversation")).performClick()
            app.onNodeWithText("Start Review").performClick()
            val input = engine.commands().single { it.string("type") == "review" }.obj("input")
            assertEquals(tree(json("scope" to json("type" to "uncommitted"), "threadMode" to "current",
                "automation" to json("enabled" to false, "maxPriority" to "p2", "maxRounds" to 3, "autoCommit" to false))), tree(input))
            app.onNodeWithContentDescription("Back to conversation").performClick()
            assertEquals("dismissReview", engine.commands().last().string("type"))
            app.onNodeWithTag("composer").assertIsDisplayed()
            app.onNodeWithContentDescription("Add").performClick()
            app.onNodeWithText("Delegate").performClick()
            assertEquals(tree(json("type" to "delegate", "startingContext" to "handoff")), tree(engine.commands().last()))
            engine.state(state(connected = false))
            app.onNodeWithContentDescription("Add").performClick()
            app.onNodeWithText("Review").assertIsNotEnabled()
            app.onNodeWithText("Delegate").assertIsNotEnabled()
        }
    }

    @Test fun unknownStartMustRefreshAndProviderChangesKeepInstructionsButRequireMatchingCatalog() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine); openReview()
            reveal(hasTestTag("review-instructions")).performTextInput("Keep focus")
            hideKeyboard()
            reveal(hasContentDescription("Reviewer engine")).performClick()
            app.onNodeWithText("Claude").performClick()
            assertEquals(tree(json("type" to "loadReview", "backend" to "claude")), tree(engine.commands().last()))
            app.onNodeWithText("Start Review").assertIsNotEnabled()
            engine.state(state(setup = setup(backend = "claude")))
            reveal(hasTestTag("review-instructions")).assertTextContains("Keep focus")
            reveal(hasContentDescription("Reviewer model")).performClick()
            app.onNodeWithText("Default Model").performClick()
            app.onNodeWithContentDescription("Reviewer service tier").assertDoesNotExist()
            app.onNodeWithContentDescription("Reviewer reasoning").assertDoesNotExist()
            reveal(hasContentDescription("Reviewer model")).performClick()
            app.onNodeWithText("Review model").performClick()
            reveal(hasContentDescription("Reviewer reasoning")).performClick()
            app.onNodeWithText("Low").performClick()
            app.onNodeWithText("Start Review").performClick()
            assertEquals("claude-review", engine.commands().last().obj("input").obj("selection").string("model"))
            assertEquals("low", engine.commands().last().obj("input").obj("selection").string("reasoningEffort"))
            engine.state(state("unknown", setup(backend = "claude")))
            app.onNodeWithText("Start Review").assertIsNotEnabled()
            reveal(hasText("Refresh")).performClick()
            assertEquals(tree(json("type" to "loadReview", "backend" to "claude")), tree(engine.commands().last()))
            engine.state(state("loading", setup(backend = "claude")))
            reveal(hasTestTag("review-instructions")).assertIsNotEnabled()
            engine.state(state(host = "another-host", setup = setup(host = "another-host")))
            app.onNodeWithTag("composer").assertIsDisplayed()
            app.onNodeWithText("Review Changes").assertDoesNotExist()
        }
    }

    @Test fun loadingFailureEmptyAndExistingReviewAreDistinctAndNeverStartNewWork() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state("loading", null)); mount(engine); openReview()
            app.onNodeWithText("Loading review setup…").assertIsDisplayed()
            engine.state(state("failed", null))
            app.onNodeWithText("Couldn’t load review setup").assertIsDisplayed()
            app.onNodeWithText("Retry").performClick()
            assertEquals(2, engine.commands().count { it.string("type") == "loadReview" })
            engine.state(state(setup = setup(changes = false)))
            app.onNodeWithText("Nothing to review").assertIsDisplayed()
            engine.state(state(setup = setup(active = true)))
            app.onNodeWithText("Review already started").assertIsDisplayed()
            app.onNodeWithText("Open Review Conversation").performClick()
            assertEquals(tree(json("type" to "selectAgent", "id" to "reviewer")), tree(engine.commands().last()))
            assertTrue(engine.commands().none { it.string("type") == "review" })
            app.onNodeWithTag("composer").assertIsDisplayed()
        }
    }
}
