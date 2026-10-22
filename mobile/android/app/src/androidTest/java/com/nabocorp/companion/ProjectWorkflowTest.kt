package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native acquisition failure modes: wrong repository identity, invalid names, stale catalogs,
 * accidental duplicate creation, lost form/provider choice, or commands crossing host/team context.
 * Real native navigation and bundled engine port; only engine results are scripted. */
class ProjectWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(host: String = "host", team: String = "team", connected: Boolean = true, creation: String = "idle") = json(
        "startup" to "ready", "conversationReady" to true, "connection" to if (connected) "connected" else "reconnecting", "laptopId" to host, "teamId" to team,
        "agentId" to "agent", "composerTarget" to ConversationTarget(host, "local", team, "agent", "session").toJson(), "canSend" to connected,
        "laptops" to JSONArray().put(json("id" to host, "name" to "Computer")), "teams" to JSONArray().put(json("id" to team, "name" to "Team")),
        "groups" to JSONArray().put(json("id" to "group-key", "kind" to "repository", "repositoryRoot" to "repo-key", "label" to "Fixture repository", "sessions" to JSONArray())),
        "backends" to JSONArray(listOf("codex", "claude")), "capabilities" to json(), "chatCreation" to creation)
    private fun branches(repository: String = "repo-key", status: String = "loaded") = json("repositoryId" to repository, "status" to status,
        "items" to JSONArray().put(json("name" to "main", "isDefault" to true, "isCheckedOut" to true)).put(json("name" to "feature/native", "isDefault" to false, "isCheckedOut" to false)))
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } } }
    }
    private fun newAgent(item: String) {
        app.onNodeWithContentDescription("Open workspace").performClick()
        app.onNodeWithText("New Agent").performClick()
        app.onNodeWithText(item).performClick()
    }
    private fun repository(item: String) {
        app.onNodeWithContentDescription("Open workspace").performClick()
        app.onNode(hasContentDescription("Agent view: Activity") or hasContentDescription("Agent view: Repository")).performClick()
        app.onNode(hasText("Repository") and hasAnyAncestor(isPopup())).performClick()
        app.onNodeWithContentDescription("New agent in Fixture repository").performClick()
        app.onNodeWithText(item).performClick()
    }
    private fun tree(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { tree(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { tree(value.get(it)) }
        else -> value
    }
    private fun assertCommand(engine: NativeEngineFixture, expected: JSONObject) {
        // A native click can finish before the asynchronous WebView command is delivered.
        app.waitUntil(5_000) { tree(engine.commands().lastOrNull()) == tree(expected) }
        assertEquals(tree(expected), tree(engine.commands().last()))
    }

    @Test fun existingProjectUsesHostCatalogAndTheSameBranchPickerAsGitHub() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state().put("backends", JSONArray(listOf("codex")))); mount(engine); newAgent("Existing Project")
            assertCommand(engine, json("type" to "loadProjectRepositories", "source" to "local"))
            val repositories = JSONArray()
            repeat(80) { index -> repositories.put(if (index == 25) json("id" to "opaque-local", "name" to "Local repository") else json("id" to "repo-$index", "name" to "Project $index")) }
            engine.state(state().put("backends", JSONArray(listOf("codex"))).put("projectRepositories", json("status" to "loaded", "items" to repositories)))
            app.onNode(hasScrollAction()).performScrollToNode(hasText("Local repository"))
            app.onNodeWithText("Local repository").performClick()
            assertCommand(engine, json("type" to "loadProjectBranches", "repositoryId" to "opaque-local", "source" to "local"))
            engine.state(state().put("backends", JSONArray(listOf("codex"))).put("projectBranches", branches("opaque-local")))
            app.onNodeWithText("New Branch").assertIsDisplayed()
            app.onNodeWithText("main").assertIsDisplayed()
            app.onNodeWithText("feature/native").performClick()
            assertCommand(engine, json("type" to "createProject", "source" to "local", "value" to "opaque-local", "backend" to "codex", "branch" to "feature/native"))
        }
    }

    @Test fun renameCapturesTheTargetValidatesTheNameAndCanBeCancelled() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state().put("header", json("title" to "Original"))); mount(engine)
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNodeWithText("Rename Agent").performClick()
            app.onNodeWithTag("agent-name").assertTextContains("Original").performTextReplacement("   ")
            app.onNodeWithText("Save").assertIsNotEnabled()
            app.onNodeWithTag("agent-name").performTextReplacement("Discarded")
            app.onNodeWithText("Cancel").performClick()
            assertFalse(engine.commands().any { it.string("type") == "renameAgent" })
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNodeWithText("Rename Agent").performClick()
            app.onNodeWithTag("agent-name").performTextReplacement("  Mobile work  ")
            app.onNodeWithText("Save").performClick()
            assertCommand(engine, json("type" to "renameAgent", "target" to ConversationTarget("host", "local", "team", "agent", "session").toJson(), "name" to "Mobile work"))
        }
    }

    @Test fun duplicateAgentStartsImmediatelyWithoutAFormAndReportsFailureForAnExplicitRetry() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state().put("backend", "codex")); mount(engine)
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNodeWithText("Duplicate Agent").performClick()
            val expected = json("type" to "duplicateAgent", "target" to ConversationTarget("host", "local", "team", "agent", "session").toJson(), "backend" to "codex")
            assertCommand(engine, expected)
            app.onNodeWithContentDescription("Choose engine").assertDoesNotExist()
            app.onNodeWithContentDescription("Cancel creation").assertDoesNotExist()
            engine.state(state(creation = "creating").put("backend", "codex"))
            engine.state(state(creation = "failed").put("backend", "codex"))
            app.onNodeWithText("Couldn’t duplicate the agent").assertIsDisplayed()
            app.onNodeWithText("OK").performClick()
            app.onNodeWithContentDescription("Conversation actions").performClick()
            app.onNodeWithText("Duplicate Agent").performClick()
            app.waitUntil(5_000) { engine.commands().count { it.string("type") == "duplicateAgent" } == 2 }
            assertCommand(engine, expected)
            engine.state(state(creation = "creating").put("backend", "codex"))
            engine.state(state().put("agentId", "duplicate").put("backend", "codex")
                .put("composerTarget", ConversationTarget("host", "local", "team", "duplicate", null).toJson()).put("canSelectBackend", true))
            app.onNodeWithContentDescription("Choose engine").assertDoesNotExist()
            app.onNodeWithContentDescription("Conversation actions").assertIsDisplayed()
            assertEquals(2, engine.commands().count { it.string("type") == "duplicateAgent" })
        }
    }

    @Test fun newProjectValidatesNamesRetainsChoicesAcrossRecreationAndRequiresAnExplicitRetry() {
        val preferences = app.activity.getSharedPreferences("preferences", 0)
        val previous = preferences.getString("newChat.backend", null)
        preferences.edit().putString("newChat.backend", "unavailable").commit()
        try {
            NativeEngineFixture(app.activityRule.scenario).use { engine ->
                app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
                engine.state(state()); mount(engine); newAgent("New Project")
                app.onNodeWithText("Create Project").assertIsNotEnabled()
                listOf(".", "..", "bad/name", "bad\\name").forEach {
                    app.onNodeWithTag("project-value").performTextReplacement(it)
                    app.onNodeWithText("Create Project").assertIsNotEnabled()
                }
                app.onNodeWithTag("project-value").performTextReplacement("  native-project  ")
                app.runOnIdle { engine.model.chooseCreationBackend("claude") }
                app.activityRule.scenario.recreate(); mount(engine)
                app.onNodeWithTag("project-value").assertTextContains("  native-project  ")
                app.onNodeWithText("Create Project").performClick()
                assertCommand(engine, json("type" to "createProject", "source" to "new", "value" to "native-project", "backend" to "claude"))
                app.onNodeWithText("Preparing your project").assertIsDisplayed()
                app.onNodeWithContentDescription("Cancel creation").assertDoesNotExist()
                engine.state(state(creation = "creating"))
                assertEquals(1, engine.commands().count { it.string("type") == "createProject" })
                engine.state(state(creation = "failed"))
                app.onNodeWithText("Couldn’t open the project.", substring = true).assertIsDisplayed()
                app.onNodeWithTag("project-value").assertTextContains("  native-project  ")
                app.onNodeWithText("Create Project").performClick()
                assertEquals(2, engine.commands().count { it.string("type") == "createProject" })
                engine.state(state(creation = "creating")); engine.state(state())
                app.onNodeWithTag("composer").assertIsDisplayed()
                assertEquals("claude", preferences.getString("newChat.backend", null))
            }
        } finally { preferences.edit().putString("newChat.backend", previous).commit() }
    }

    @Test fun urlCloneAndQuickChatUseOnlyAnAvailableEngineAndDisconnectedControlsCannotCreate() {
        val preferences = app.activity.getSharedPreferences("preferences", 0)
        val previous = preferences.getString("newChat.backend", null)
        preferences.edit().putString("newChat.backend", "missing-provider").commit()
        try {
            NativeEngineFixture(app.activityRule.scenario).use { engine ->
                app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
                engine.state(state()); mount(engine); newAgent("From URL")
                app.onNodeWithTag("project-value").performTextInput("  git@github.com:org/repo.git  ")
                app.onNodeWithTag("project-value").assertTextContains("  git@github.com:org/repo.git  ")
                engine.state(state(connected = false))
                app.onNodeWithText("Laptop disconnected").assertIsDisplayed()
                app.onNodeWithText("Clone Repository").assertDoesNotExist()
                app.onNodeWithText("Reconnect").performClick()
                assertCommand(engine, json("type" to "reconnect"))
                engine.state(state())
                app.onNodeWithTag("project-value").assertTextContains("  git@github.com:org/repo.git  ")
                app.onNodeWithText("Clone Repository").performClick()
                assertCommand(engine, json("type" to "createProject", "source" to "url", "value" to "git@github.com:org/repo.git", "backend" to "codex"))
                engine.state(state(creation = "creating")); engine.state(state())
                newAgent("Quick Chat")
                assertCommand(engine, json("type" to "newQuickChat", "backend" to "codex"))
                engine.state(state(creation = "creating")); engine.state(state())
                engine.state(state(connected = false))
                app.onNodeWithContentDescription("Open workspace").performClick()
                app.onNodeWithText("New Agent").assertIsNotEnabled()
            }
        } finally { preferences.edit().putString("newChat.backend", previous).commit() }
    }

    @Test fun githubSearchRetryAndNewBranchKeepRepositoryIdentityAndSelectedBase() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine); newAgent("From GitHub")
            assertCommand(engine, json("type" to "loadProjectRepositories"))
            app.onNodeWithText("Loading repositories…").assertIsDisplayed()
            engine.state(state().put("projectRepositories", json("status" to "failed", "items" to JSONArray())))
            app.onNodeWithText("Retry").performClick()
            assertEquals(2, engine.commands().count { it.string("type") == "loadProjectRepositories" })
            val catalog = json("status" to "loaded", "items" to JSONArray().put(json("id" to "org/repository", "name" to "My repository")).put(json("id" to "org/other", "name" to "Other repository")))
            engine.state(state().put("projectRepositories", catalog))
            app.onNodeWithTag("repository-search").performTextInput("my")
            app.onNodeWithText("Other repository").assertDoesNotExist()
            app.onNodeWithText("My repository").performClick()
            assertCommand(engine, json("type" to "loadProjectBranches", "repositoryId" to "org/repository"))
            engine.state(state().put("projectBranches", branches("org/other")))
            app.onNodeWithText("Loading branches…").assertIsDisplayed()
            app.onNodeWithText("feature/native").assertDoesNotExist()
            engine.state(state().put("projectBranches", branches("org/repository")))
            app.runOnIdle { engine.model.chooseCreationBackend("codex") }
            app.onNodeWithTag("branch-search").performTextInput("native")
            app.onNodeWithText("feature/native").performClick()
            assertCommand(engine, json("type" to "createProject", "source" to "github", "value" to "org/repository", "backend" to "codex", "branch" to "feature/native"))
            engine.state(state(creation = "creating").put("projectBranches", branches("org/repository")))
            engine.state(state(creation = "failed").put("projectBranches", branches("org/repository")))
            app.onNodeWithText("New Branch").performClick()
            app.onNodeWithTag("branch-name").performTextInput(" main ")
            app.onNodeWithText("Create Branch").assertIsNotEnabled()
            app.onNodeWithTag("branch-name").performTextReplacement("feature/android")
            app.onNodeWithContentDescription("Base branch").performClick()
            app.onNodeWithText("feature/native").performClick()
            app.onNodeWithText("Create Branch").performClick()
            assertCommand(engine, json("type" to "createProject", "source" to "github", "value" to "org/repository", "backend" to engine.model.state.strings("backends").first(),
                "worktree" to json("branchName" to "feature/android", "baseBranch" to "feature/native")))
            engine.state(state(creation = "creating")); engine.state(state())
            app.onNodeWithTag("composer").assertIsDisplayed()
        }
    }

    @Test fun existingBranchAndWorktreeUseOpaqueRepositoryRootRatherThanSidebarGroupId() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state().put("backends", JSONArray(listOf("codex")))); mount(engine); repository("Existing Branch…")
            assertCommand(engine, json("type" to "loadBranches", "repositoryId" to "repo-key"))
            engine.state(state().put("backends", JSONArray(listOf("codex"))).put("branches", branches(status = "failed")))
            app.onNodeWithText("Retry").performClick()
            assertEquals(2, engine.commands().count { it.string("type") == "loadBranches" })
            engine.state(state().put("backends", JSONArray(listOf("codex"))).put("branches", branches()))
            app.onNodeWithTag("branch-search").performTextInput("feature")
            app.onNodeWithText("main").assertDoesNotExist()
            app.onNodeWithText("feature/native").performClick()
            assertCommand(engine, json("type" to "newChat", "repositoryId" to "repo-key", "backend" to "codex", "existingBranch" to "feature/native"))
            engine.state(state(creation = "creating")); engine.state(state())
            repository("New Worktree…")
            app.onNodeWithTag("branch-name").performTextInput("feature android")
            app.onNodeWithText("Create").performClick()
            assertCommand(engine, json("type" to "newChat", "repositoryId" to "repo-key", "backend" to "codex", "branchName" to "feature-android"))
            engine.state(state(creation = "creating")); engine.state(state())
            repository("Default Branch")
            assertCommand(engine, json("type" to "newChat", "repositoryId" to "repo-key", "backend" to "codex"))
        }
    }

    @Test fun cancelAndBackDiscardCatalogRequestsAndTeamChangesCannotReuseAForm() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine); newAgent("From GitHub")
            engine.state(state().put("projectRepositories", json("status" to "loaded", "items" to JSONArray().put(json("id" to "org/repo", "name" to "Repository")))))
            app.onNodeWithText("Repository").performClick()
            app.onNodeWithContentDescription("Back to repositories").performClick()
            assertCommand(engine, json("type" to "dismissProjectBranches"))
            app.onNodeWithContentDescription("Cancel creation").performClick()
            assertCommand(engine, json("type" to "dismissProjectRepositories"))
            newAgent("New Project")
            app.runOnIdle { engine.model.activity(true) }
            app.activityRule.scenario.onActivity {
                val event = json("channel" to "transcript", "message" to json("type" to "rendered", "receipt" to json("agentId" to "agent", "generation" to 0, "revision" to 1)))
                engine.model.transcript.view.evaluateJavascript("companionNative.postMessage(${JSONObject.quote(event.toString())})", null)
            }
            app.waitUntil(5000) { engine.model.renderedAgent == "agent" }
            assertNull(engine.model.attention.visibleTarget)
            assertTrue(engine.commands().none { it.string("type") == "read" })
            app.onNodeWithTag("project-value").performTextInput("old-host-draft")
            engine.state(state(host = "another-host", team = "another-team"))
            app.onNodeWithTag("project-value").assertDoesNotExist()
            app.onNodeWithTag("composer").assertIsDisplayed()
            assertTrue(engine.commands().none { it.string("type") == "createProject" })
        }
    }
}
