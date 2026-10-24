package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.input.key.Key
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Failure modes: wrong trigger catalogs, UTF-16 cursor replacement corrupts surrounding text,
 * display labels leak into prompts/clipboard, partial chip deletion, stale target suggestions,
 * or errors hide usable agent mentions. Runs the real native composer and engine port. */
@OptIn(ExperimentalTestApi::class)
class ComposerCompletionWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(host: String = "host") = ConversationTarget(host, "local", "team", "agent", "session")
    private val reviewer = json("id" to "agent:reviewer", "kind" to "agent", "name" to "Reviewer · team", "insertText" to "agent:reviewer", "description" to "")
    private val github = json("id" to "plugin:github", "kind" to "plugin", "name" to "GitHub", "insertText" to "github", "description" to "Repositories and pull requests")
    private val review = json("id" to "review", "name" to "Review", "insertText" to "review", "description" to "Inspect pending changes")
    private val commit = json("id" to "cp", "name" to "Commit-Push (cp)", "insertText" to "cp", "description" to "Commit and push changes")
    private fun state(host: String = "host", status: String = "loaded", connected: Boolean = true) = json("startup" to "ready", "connection" to if (connected) "connected" else "reconnecting", "agentId" to "agent",
        "composerTarget" to target(host).toJson(), "canSend" to connected, "capabilities" to json(),
        "mentions" to json("status" to status, "items" to JSONArray().put(reviewer).put(github)),
        "skills" to json("status" to status, "items" to JSONArray().put(review).put(commit)))
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { Composer(engine.model, {}, {}) } } }
    }
    private fun renderedText(): String {
        val layouts = mutableListOf<TextLayoutResult>()
        app.onNodeWithTag("composer").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        return layouts.last().layoutInput.text.text.replace('\u00a0', ' ')
    }

    @Test fun followUpPlaceholderBecomesAnEditableDraftOnlyOnSpaceInAnEmptyComposer() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val suggestion = "Review the changes 🦞"
            engine.state(state().put("suggestedPrompt", suggestion)); mount(engine)
            app.onNodeWithText(suggestion).assertIsDisplayed()
            assertEquals("", engine.model.draft)
            app.onNodeWithTag("composer").performTextInput(" ")
            app.onNodeWithTag("composer").assertTextEquals(suggestion)
            app.onNodeWithTag("composer").performTextInput(" please")
            app.onNodeWithTag("composer").assertTextEquals("$suggestion please")
            assertTrue(engine.commands().none { it.string("type") == "send" })
            app.onNodeWithTag("composer").performTextClearance()
            app.onNodeWithTag("composer").performTextInput("My own prompt")
            engine.state(state().put("suggestedPrompt", "A newer suggestion"))
            app.onNodeWithTag("composer").assertTextEquals("My own prompt")
            app.onNodeWithTag("composer").performTextInput(" ")
            app.onNodeWithTag("composer").assertTextEquals("My own prompt ")
            engine.state(state("other"))
            app.onNodeWithText("A newer suggestion").assertDoesNotExist()
            app.onNodeWithTag("composer").performTextInput(" ")
            assertEquals(" ", engine.model.draft)
            engine.state(state().put("suggestedPrompt", "A newer suggestion").put("composer", json("planMode" to true)))
            app.onNodeWithTag("composer").performTextClearance()
            app.onNodeWithText("Describe what to plan").assertIsDisplayed()
            app.onNodeWithTag("composer").performTextInput(" ")
            assertEquals(" ", engine.model.draft)
        }
    }

    @Test fun choosingAMentionAtTheCursorPreservesUnicodeAndSuffixAndSendsCanonicalText() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            val draft = "🦞 Ask @review later"
            app.onNodeWithTag("composer").performTextInput(draft)
            app.onNodeWithTag("composer").performTextInputSelection(TextRange(draft.indexOf("@rev") + 4))
            app.onNodeWithText("Agents & Plugins").assertIsDisplayed()
            app.onNodeWithText("GitHub").assertDoesNotExist()
            app.onNodeWithText("Reviewer · team").performClick()
            assertEquals("🦞 Ask @agent:reviewer later", engine.model.draft)
            assertTrue(renderedText().contains("Reviewer · team"))
            assertFalse(renderedText().contains("agent:reviewer"))
            app.onNodeWithText("Agents & Plugins").assertDoesNotExist()
            app.onNodeWithContentDescription("Send").performClick()
            val sent = engine.commands().single { it.string("type") == "send" }
            assertEquals("🦞 Ask @agent:reviewer later", sent.string("text"))
            assertEquals(target(), ConversationTarget.parse(sent.obj("target")))
            assertTrue(engine.commands().any { it.string("type") == "loadMentions" })
        }
    }

    @Test fun skillChipsCopyCanonicalTokensAndOneBackspaceRemovesTheWholeChip() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            val clipboard = app.activity.getSystemService(android.content.ClipboardManager::class.java)
            app.waitUntil(5000) { app.activity.hasWindowFocus() }
            app.runOnIdle {
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Native test", "before-chip-copy"))
                assertEquals("before-chip-copy", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
            }
            app.onNodeWithTag("composer").performTextInput("🦞 Please \$push")
            app.onNodeWithText("Commit-Push (cp)").performClick()
            val canonical = "🦞 Please \$cp "
            assertEquals(canonical, engine.model.draft)
            assertTrue(renderedText().contains("Commit-Push (cp)"))
            app.onNodeWithTag("composer").performTextInputSelection(TextRange(canonical.indexOf('$'), canonical.length - 1))
            app.onNodeWithTag("composer").assert(SemanticsMatcher.expectValue(SemanticsProperties.TextSelectionRange, TextRange(canonical.indexOf('$'), canonical.length - 1)))
            app.onNodeWithTag("composer").performSemanticsAction(SemanticsActions.CopyText) { it() }
            app.waitUntil(5000) { clipboard.primaryClip?.getItemAt(0)?.text?.toString() == "\$cp" }
            app.onNodeWithTag("composer").performTextInputSelection(TextRange(canonical.length))
            app.onNodeWithTag("composer").performKeyInput { keyDown(Key.Backspace); keyUp(Key.Backspace) }
            assertEquals("🦞 Please \$cp", engine.model.draft)
            app.onNodeWithText("Skills").assertDoesNotExist()
            app.onNodeWithTag("composer").performKeyInput { keyDown(Key.Backspace); keyUp(Key.Backspace) }
            assertEquals("🦞 Please ", engine.model.draft)
            assertFalse(renderedText().contains("Commit-Push (cp)"))
            assertTrue(engine.commands().any { it.string("type") == "loadSkills" })
        }
    }

    @Test fun catalogFailuresKeepAgentRowsAndRetryDismissAndTargetChangesStayScoped() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(status = "loading")); mount(engine)
            app.onNodeWithTag("composer").performTextInput("@")
            app.onNodeWithText("Reviewer · team").assertIsDisplayed()
            app.onNodeWithText("Loading plugins…").assertIsDisplayed()
            engine.state(state(status = "failed"))
            app.onNodeWithText("Couldn’t load plugins.").assertIsDisplayed()
            val before = engine.commands().count { it.string("type") == "loadMentions" }
            app.onNodeWithText("Retry").performClick()
            assertEquals(before + 1, engine.commands().count { it.string("type") == "loadMentions" })
            app.onNodeWithContentDescription("Dismiss suggestions").performClick()
            app.onNodeWithText("Agents & Plugins").assertDoesNotExist()
            app.onNodeWithTag("composer").performTextInput("pull")
            app.onNodeWithText("GitHub").assertIsDisplayed()
            app.onNodeWithText("Reviewer · team").assertDoesNotExist()
            engine.state(state(host = "other-host"))
            app.onNodeWithText("Agents & Plugins").assertDoesNotExist()
            assertEquals("", engine.model.draft)
            app.onNodeWithTag("composer").performTextInput("\$absent")
            app.onNodeWithText("No matching skills.").assertIsDisplayed()
            engine.state(state(host = "other-host", connected = false))
            app.onNodeWithText("Skills").assertDoesNotExist()
        }
    }

    @Test fun emailCodeUrlsMoneyAndNonCollapsedSelectionsDoNotTriggerCompletion() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            listOf("name@example.com", "`@github", "https://host/@git", "price\$20", "\$a/b", "@@").forEach { text ->
                app.onNodeWithTag("composer").performTextReplacement(text)
                app.onNodeWithText("Agents & Plugins").assertDoesNotExist()
                app.onNodeWithText("Skills").assertDoesNotExist()
            }
            app.onNodeWithTag("composer").performTextReplacement("@rev")
            app.onNodeWithTag("composer").performTextInputSelection(TextRange(0, 4))
            app.onNodeWithText("Agents & Plugins").assertDoesNotExist()
            assertTrue(engine.commands().none { it.string("type") == "loadSkills" })
        }
    }
}
