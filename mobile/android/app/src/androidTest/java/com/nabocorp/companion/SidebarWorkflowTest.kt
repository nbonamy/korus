package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.key
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Rule
import org.junit.Test

/** Native sidebar regressions: scope leakage or lost preferences; idle order computed outside
 * the engine; duplicate/vanished agents on activity moves; hidden unread/error states. */
class SidebarWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private val preferences get() = app.activity.getSharedPreferences("sidebar", 0)
    private var previous = emptyMap<String, Any?>()
    @Before fun isolatePreferences() { previous = preferences.all.toMap(); preferences.edit().clear().commit() }
    @After fun restorePreferences() { preferences.edit().clear().apply { previous.forEach { (key,value) -> putString(key, value as? String) } }.commit() }
    private fun session(id: String, title: String, status: String = "idle", unread: Boolean = false) = json("agentId" to id, "displayTitle" to title, "status" to json("type" to status), "isUnread" to unread)
    private fun group(id: String, label: String, vararg sessions: JSONObject, activity: String? = null) = json("id" to id, "label" to label, "kind" to "folder", "activity" to activity, "sessions" to JSONArray(sessions.toList()))
    private fun state(host: String = "host", team: String = "one", finished: Boolean = false, repositoryOrder: Boolean = false): JSONObject {
        val worker = session("worker", "Working agent", if (finished) "idle" else "working", true)
        val alpha = session("alpha", "Alpha agent", "error")
        val zebra = session("zebra", "Zebra agent")
        return json("startup" to "ready", "connection" to "connected", "laptopId" to host, "teamId" to team, "agentId" to "worker", "canSend" to true,
            "composerTarget" to ConversationTarget(host,"local",team,"worker","session").toJson(), "laptops" to JSONArray().put(json("id" to host)), "backends" to JSONArray(listOf("codex")),
            "teams" to JSONArray().put(json("id" to "one", "name" to "Team one")).put(json("id" to "two", "name" to "Team two", "isUnread" to true)),
            "groups" to JSONArray().put(group("repo", "Repository group", worker, alpha, zebra)),
            "activityGroups" to JSONArray().put(group("empty", "Empty header", activity = "attention"))
                .put(group("worker-group", if (finished) "Done" else "Working", worker, activity = if (finished) "recent" else "working"))
                .put(group("idle", "Idle", *(if (repositoryOrder) arrayOf(alpha,zebra) else arrayOf(zebra,alpha)), activity = "idle")))
    }
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { key(engine.model) { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } } } }
    }
    private fun menuChoice(description: String, label: String) {
        app.onNodeWithContentDescription(description).performClick()
        app.onNode(hasText(label) and hasAnyAncestor(isPopup())).performClick()
    }

    private fun assertCommand(engine: NativeEngineFixture, expected: JSONObject) {
        fun fields(value: JSONObject) = value.keys().asSequence().associateWith { value.get(it) }
        app.waitUntil(5_000) { engine.commands().lastOrNull()?.let(::fields) == fields(expected) }
        assertEquals(fields(expected), fields(engine.commands().last()))
    }

    /** A long team rail must not scroll the product mark away, hide unread activity,
     * or lose exclusive team selection and its command target. */
    @Test fun teamRailKeepsTheProductMarkFixedAndExposesSelectedAndUnreadTeams() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val teams = JSONArray((1..12).map { json("id" to "t$it", "name" to "Team $it", "isUnread" to (it == 12)) })
            engine.state(state(team = "t1").put("teams", teams)); mount(engine)
            app.onNodeWithContentDescription("Open workspace").performClick()
            val mark = app.onNodeWithContentDescription(engine.model.product.string("name"))
            val initialMark = mark.assertIsDisplayed().getUnclippedBoundsInRoot()
            app.onNodeWithContentDescription("Team 1").assertIsSelected()
                .assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.Role, androidx.compose.ui.semantics.Role.Tab))
            app.onNodeWithContentDescription("Team 12, unread activity").performScrollTo().assertIsDisplayed().performClick()
            assertCommand(engine, json("type" to "selectTeam", "id" to "t12"))
            assertEquals(initialMark, mark.assertIsDisplayed().getUnclippedBoundsInRoot())
            engine.state(state(team = "t12").put("teams", teams))
            app.onNodeWithContentDescription("Team 12").assertIsSelected()
            app.onNodeWithContentDescription("Team 12, unread activity").assertDoesNotExist()
        }
    }

    /** Repository navigation must distinguish branch kinds and keep the Quick Chats
     * shortcut routed through the existing creation contract. */
    @Test fun repositoryRowsExposeSessionKindsAndQuickChatsCanStartAChat() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val groups = JSONArray().put(group("repo", "Repository group",
                session("main", "Main agent").put("kind", "main"),
                session("branch", "Branch agent").put("kind", "branch"),
                session("tree", "Worktree agent", "awaitingInput", true).put("kind", "worktree"))
                .put("kind", "repository").put("repositoryRoot", "opaque-repository"))
                .put(group("quick", "Quick Chats", session("quick-agent", "Notes")).put("kind", "quickChats"))
            engine.state(state().put("groups", groups)); mount(engine)
            app.onNodeWithContentDescription("Open workspace").performClick()
            menuChoice("Agent view: Activity", "Repository")
            val descriptions = mapOf("Main agent" to "Idle, Main", "Branch agent" to "Idle, Branch", "Worktree agent" to "Needs input, unread, Worktree")
            descriptions.forEach { (title, description) -> app.onNodeWithText(title).assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, description)) }
            app.onNodeWithText("Branch agent").performClick()
            assertCommand(engine, json("type" to "selectAgent", "id" to "branch"))
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithContentDescription("New chat").performClick()
            assertCommand(engine, json("type" to "newQuickChat", "backend" to "codex"))
            app.onNodeWithText("Starting your chat").assertIsDisplayed()
        }
    }

    /** A disconnected drawer must offer recovery without opening Settings, and
     * must not create work until the host reconnects. */
    @Test fun disconnectedDrawerOffersReconnectAndGuardsNewWork() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state().put("connection", "reconnecting")); mount(engine)
            app.runOnIdle { engine.model.activity(true) }
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.waitUntil(8_000) { engine.model.showConnectionLost }
            app.onNodeWithText("New agent").assertIsNotEnabled()
            app.onNodeWithContentDescription("Reconnect computer").assertIsDisplayed().performClick()
            assertCommand(engine, json("type" to "reconnect"))
            app.onNodeWithContentDescription("Settings").performClick()
            app.onNodeWithContentDescription("Reconnect computer").assertDoesNotExist()
            app.onAllNodes(hasText("Connection lost") and hasAnyAncestor(isDialog())).assertCountEquals(1)
            app.onNodeWithText("Done").performClick()
            app.onNodeWithContentDescription("Open workspace").performClick()
            engine.state(state())
            app.onNodeWithContentDescription("Reconnect computer").assertDoesNotExist()
            app.onNodeWithText("New agent").assertIsEnabled()
        }
    }

    @Test fun organizationAndIdleOrderPersistPerComputerAndTeamAndRestoreOnRelaunch() {
        NativeEngineFixture(app.activityRule.scenario).use { first ->
            app.waitUntil(20_000) { first.model.state.string("startup") == "ready" }
            first.state(state()); mount(first)
            assertEquals("activity", first.commands().last { it.string("type") == "idleSort" }.string("order"))
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithContentDescription("Agent view: Activity").assertIsDisplayed()
            menuChoice("Sort Idle agents", "Repository")
            assertEquals("repository", first.commands().last().string("order"))
            first.state(state(repositoryOrder = true))
            assertTrue(app.onNodeWithText("Alpha agent").getUnclippedBoundsInRoot().top < app.onNodeWithText("Zebra agent").getUnclippedBoundsInRoot().top)
            menuChoice("Agent view: Activity", "Repository")
            app.onNodeWithText("Repository group").assertIsDisplayed()
            app.onNodeWithText("Working").assertDoesNotExist()
        }
        NativeEngineFixture(app.activityRule.scenario).use { second ->
            app.waitUntil(20_000) { second.model.state.string("startup") == "ready" }
            second.state(state(repositoryOrder = true)); mount(second)
            assertEquals("repository", second.commands().last { it.string("type") == "idleSort" }.string("order"))
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithContentDescription("Agent view: Repository").assertIsDisplayed()
            app.onNodeWithContentDescription("Team two, unread activity").performClick()
            assertEquals("selectTeam", second.commands().last().string("type"))
            assertEquals("two", second.commands().last().string("id"))
            second.state(state(team = "two"))
            app.onNodeWithContentDescription("Agent view: Activity").assertIsDisplayed()
            assertEquals("activity", second.commands().last().string("order"))
            second.state(state(host = "another-host"))
            app.onNodeWithContentDescription("Agent view: Activity").assertIsDisplayed()
            second.state(state())
            app.onNodeWithContentDescription("Agent view: Repository").assertIsDisplayed()
            assertEquals("repository", second.commands().last().string("order"))
        }
    }

    @Test fun activityMovesKeepOneSelectedAgentAndExposeUnreadAndErrorStatus() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithText("Empty header").assertDoesNotExist()
            app.onNodeWithText("Working").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Heading))
            app.onNodeWithText("Working agent").assertIsSelected()
            app.onNodeWithText("Working agent").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"Working, unread"))
            app.onNodeWithText("Alpha agent").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"Error"))
            assertTrue(app.onNodeWithText("Zebra agent").getUnclippedBoundsInRoot().top < app.onNodeWithText("Alpha agent").getUnclippedBoundsInRoot().top)
            engine.state(state(finished = true))
            app.onNodeWithText("Done").assertIsDisplayed()
            app.onNodeWithText("Working").assertDoesNotExist()
            app.onAllNodesWithText("Working agent").assertCountEquals(1)
            app.onNodeWithText("Working agent").assertIsSelected().performClick()
            assertEquals("selectAgent", engine.commands().last().string("type"))
            assertEquals("worker", engine.commands().last().string("id"))
        }
    }
}
