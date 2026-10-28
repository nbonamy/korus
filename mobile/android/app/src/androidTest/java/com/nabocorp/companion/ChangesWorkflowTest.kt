package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Changes failures: wrong opaque scope IDs, stale patches after navigation, unpainted or
 * undersized native WebViews, failures disguised as empty diffs, and reconnects not reloading.
 * Uses the real bundled diff renderer and native navigation, replacing only the engine port. */
class ChangesWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(session: String = "session") = ConversationTarget("host","local","team","agent",session)
    private fun summary(added: Int = 3, removed: Int = 1) = json("changedFiles" to 1,"addedLines" to added,"removedLines" to removed)
    private fun choices() = JSONArray().put(json("id" to "branch","label" to "Branch changes","detail" to "origin/main","summary" to summary()))
        .put(json("id" to "uncommitted","label" to "Uncommitted changes","summary" to summary()))
        .put(json("id" to "staged","label" to "Staged changes","summary" to summary()))
        .put(json("id" to "unstaged","label" to "Unstaged changes","summary" to summary()))
        .put(json("id" to "turn:opaque-turn","label" to "Last turn changes","summary" to summary()))
        .put(json("id" to "commit:full-opaque-sha","label" to "Sample commit","detail" to "abc1234","summary" to summary(9,2)))
    private fun state(status: String = "idle", scope: String = "uncommitted", connected: Boolean = true, session: String = "session", available: Boolean = true, dirty: Boolean = true) = json(
        "startup" to "ready","connection" to if (connected) "connected" else "reconnecting","laptopId" to "host","teamId" to "team","agentId" to "agent","composerTarget" to target(session).toJson(),"canSend" to connected,
        "laptops" to JSONArray().put(json("id" to "host","name" to "Computer")),"header" to json("title" to "Agent"),"capabilities" to json(),
        "git" to json("available" to available,"status" to status,"scopeId" to scope,"choices" to choices(),"summary" to summary(),"uncommitted" to json("state" to if (dirty) "dirty" else "clean")))
    private fun mount(e: NativeEngineFixture) { app.activityRule.scenario.onActivity { a -> a.setContent { MaterialTheme { CompanionApp(e.model,{},{},{},{},{},{}) } } } }
    private fun open() { app.onNodeWithContentDescription("Conversation actions").performClick(); app.onNodeWithText("Changes").performClick() }
    private fun scope(label: String, commits: Boolean = false) {
        app.onNodeWithContentDescription("Change scope").performClick()
        if (commits) app.onNodeWithText("Commits").performClick()
        app.onNode(hasText(label,substring = true) and hasAnyAncestor(isPopup())).performClick()
        app.waitForIdle()
    }
    private fun commands(e: NativeEngineFixture, type: String) = e.commands().filter { it.string("type") == type }
    private fun pageText(e: NativeEngineFixture): String {
        val ready = CountDownLatch(1); val value = AtomicReference("")
        app.activityRule.scenario.onActivity { e.model.changes.view.evaluateJavascript("document.body.innerText") { encoded -> value.set(JSONTokener(encoded).nextValue() as? String ?: ""); ready.countDown() } }
        assertTrue(ready.await(5,TimeUnit.SECONDS)); return value.get()
    }
    private fun patch(label: String) = "diff --git a/native.txt b/native.txt\nindex 1111111..2222222 100644\n--- a/native.txt\n+++ b/native.txt\n@@ -1 +1 @@\n-old line\n+$label\n"
    private fun render(e: NativeEngineFixture, scope: String, label: String) {
        e.event("gitDiff",json("diff" to patch(label))); e.state(state("loaded",scope))
        app.waitUntil(15_000) { pageText(e).contains(label) }
        app.onNodeWithTag("changes-patch").assertIsDisplayed()
    }
    private fun tree(v: Any?): Any? = when(v) { JSONObject.NULL -> null; is JSONObject -> v.keys().asSequence().associateWith { tree(v.get(it)) }; is JSONArray -> (0 until v.length()).map { tree(v.get(it)) }; else -> v }
    private fun last(e: NativeEngineFixture, expected: JSONObject) = assertEquals(tree(expected),tree(e.commands().last()))

    @Test fun transcriptFilePreviewHidesComposerRoutesOneReadAndBackRestoresDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state()); mount(e)
            app.onNodeWithTag("composer").performTextInput("Keep this draft")
            val agent = json("id" to "agent", "name" to "Agent", "backend" to "codex", "status" to json("type" to "idle"))
            val payload = json("agentId" to "agent", "agent" to agent, "generation" to 1, "ready" to true, "peers" to JSONArray(),
                "frame" to json("payload" to json("snapshot" to json("messages" to JSONArray().put(json("id" to "m", "role" to "assistant", "status" to "complete", "parts" to JSONArray().put(json("type" to "text", "text" to "Read [app.kt](src/app.kt:1)")))), "turns" to JSONArray(), "busy" to false))))
            e.event("conversation", payload)
            fun js(script: String): String {
                val done = CountDownLatch(1); val value = AtomicReference("")
                app.activityRule.scenario.onActivity { e.model.transcript.view.evaluateJavascript(script) { value.set(it); done.countDown() } }
                assertTrue(done.await(5,TimeUnit.SECONDS)); return value.get()
            }
            app.waitUntil(10_000) { js("!!document.querySelector('a[href=\"src/app.kt:1\"]')") == "true" }
            js("document.querySelector('a[href=\"src/app.kt:1\"]').click();true")
            app.waitUntil(5000) { commands(e,"readFilePreview").isNotEmpty() }
            app.onNodeWithTag("composer").assertDoesNotExist()
            val request = commands(e,"readFilePreview").last()
            assertEquals("agent",request.string("agentId"))
            assertEquals("src/app.kt",request.obj("input").string("path"))
            e.event("conversationFile",json("type" to "conversationFile", "requestId" to request.string("requestId"),"agentId" to "agent", "preview" to json("path" to "src/app.kt", "source" to json("path" to "src/app.kt","kind" to "text","size" to 20,"content" to "val nativeSource = true"), "diff" to patch("nativeChange"), "diffScope" to "turn")))
            app.waitUntil(10_000) { js("document.body.textContent.includes('nativeSource')") == "true" }
            js("Array.from(document.querySelectorAll('[aria-label=\"File view\"] button')).find(b => b.textContent === 'Diff').click();true")
            app.waitUntil(10_000) { js("document.body.textContent.includes('nativeChange')") == "true" }
            assertEquals(1,commands(e,"readFilePreview").size)
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
        }
    }

    @Test fun scopesRenderActualPatchesAndKeepSelectionAndComposerAcrossRecreation() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state()); mount(e)
            app.onNodeWithTag("composer").performTextInput("Unsent draft"); app.onNodeWithTag("composer").assertTextContains("Unsent draft")
            open(); app.onNodeWithText("Loading changes…").assertIsDisplayed(); last(e,json("type" to "loadChanges"))
            e.state(state("loading")); app.onNodeWithContentDescription("Refresh changes").assertIsNotEnabled()
            render(e,"uncommitted","uncommitted patch")
            app.onNodeWithText("+3").assertIsDisplayed(); app.onNodeWithText("−1").assertIsDisplayed()
            app.runOnIdle { assertTrue(e.model.changes.view.width > 0); assertTrue(e.model.changes.view.height > app.activity.resources.displayMetrics.heightPixels / 2) }
            scope("Branch changes"); last(e,json("type" to "loadChanges","scopeId" to "branch"))
            e.state(state("loading","branch")); app.onNodeWithTag("changes-patch").assertDoesNotExist()
            render(e,"branch","branch patch")
            scope("Sample commit",commits = true); last(e,json("type" to "loadChanges","scopeId" to "commit:full-opaque-sha"))
            render(e,"commit:full-opaque-sha","commit patch")
            val count=commands(e,"loadChanges").size
            app.activityRule.scenario.recreate(); mount(e)
            app.onNodeWithText("Sample commit").assertIsDisplayed()
            app.waitUntil(10_000) { pageText(e).contains("commit patch") }
            assertEquals(count,commands(e,"loadChanges").size)
            app.onNodeWithContentDescription("Close changes").performClick()
            app.onNodeWithTag("composer").assertTextContains("Unsent draft")
            assertEquals(1,commands(e,"dismissChanges").size)
        }
    }

    @Test fun failuresAreNotEmptyDiffsAndReconnectReloadsWithoutReplayingAnOldScope() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state()); mount(e); open()
            e.state(state("failed")); app.onNodeWithText("Couldn’t load changes").assertIsDisplayed(); app.onNodeWithTag("changes-patch").assertDoesNotExist()
            app.onNodeWithText("Retry").performClick(); app.waitForIdle(); last(e,json("type" to "loadChanges"))
            e.state(state("idle",connected=false))
            app.onNodeWithText("Laptop disconnected").assertIsDisplayed()
            app.onNodeWithContentDescription("Refresh changes").assertIsNotEnabled(); app.onNodeWithContentDescription("Change scope").assertIsNotEnabled()
            app.onNodeWithText("Reconnect").performClick(); app.waitForIdle(); last(e,json("type" to "reconnect"))
            val count=commands(e,"loadChanges").size
            e.state(state()); app.onNodeWithText("Loading changes…").assertIsDisplayed()
            app.waitUntil(5_000) { commands(e,"loadChanges").size == count+1 }
            e.event("gitDiff",json("diff" to "")); e.state(state("loaded"))
            app.onNodeWithTag("changes-patch").assertIsDisplayed()
            app.waitUntil(10_000) { pageText(e).contains("No diff content.") }
            app.onNodeWithContentDescription("Refresh changes").performClick(); app.waitForIdle(); last(e,json("type" to "loadChanges"))
            scope("Staged changes"); last(e,json("type" to "loadChanges","scopeId" to "staged"))
            scope("Unstaged changes"); last(e,json("type" to "loadChanges","scopeId" to "unstaged"))
            scope("Last turn changes"); last(e,json("type" to "loadChanges","scopeId" to "turn:opaque-turn"))
        }
    }

    @Test fun sessionReplacementDismissesAndLateDiffsCannotLeakIntoAnotherConversation() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state()); mount(e); open(); render(e,"uncommitted","original session patch")
            e.state(state(session="replacement"))
            app.onNodeWithTag("changes-patch").assertDoesNotExist(); app.onNodeWithTag("composer").assertIsDisplayed()
            app.waitUntil(5_000) { commands(e,"dismissChanges").size == 1 }
            e.event("gitDiff",json("diff" to patch("late original patch")))
            open(); app.onNodeWithText("Loading changes…").assertIsDisplayed()
            e.event("gitDiff",json("diff" to "")); e.state(state("loaded",session="replacement"))
            app.waitUntil(10_000) { pageText(e).contains("No diff content.") }
            assertFalse(pageText(e).contains("original"))
        }
    }

    @Test fun changesAvailabilityAndDirtyIndicatorFollowEngineState() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state(available=false,dirty=false)); mount(e)
            app.onNodeWithContentDescription("Conversation actions").performClick(); app.onNodeWithText("Changes").assertDoesNotExist()
            e.state(state(connected=false))
            app.onNodeWithText("Changes").assertIsNotEnabled()
            assertTrue(commands(e,"loadChanges").isEmpty())
            app.activityRule.scenario.recreate(); mount(e)
            app.onNodeWithContentDescription("Conversation actions").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"Uncommitted changes"))
        }
    }
}
