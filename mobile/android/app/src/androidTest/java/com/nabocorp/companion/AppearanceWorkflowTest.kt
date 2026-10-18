package com.nabocorp.companion

import android.app.UiModeManager
import android.content.res.Configuration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** A dark native shell with a light transcript/diff is unreadable. Real Android
 * appearance changes must reach both bundled pages without losing the draft.
 * The app-local override affects only the isolated verification installation. */
class AppearanceWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun probe(engine: NativeEngineFixture, changes: Boolean): JSONObject {
        val done = CountDownLatch(1); val result = AtomicReference<String>()
        app.activityRule.scenario.onActivity { activity ->
            val page = if (changes) engine.model.changes else engine.model.transcript
            val appTheme = android.util.TypedValue(); val activityTheme = android.util.TypedValue()
            page.view.context.theme.resolveAttribute(android.R.attr.isLightTheme, appTheme, true)
            activity.theme.resolveAttribute(android.R.attr.isLightTheme, activityTheme, true)
            page.view.evaluateJavascript("JSON.stringify({dark:matchMedia('(prefers-color-scheme: dark)').matches,scheme:getComputedStyle(document.documentElement).colorScheme,conversationVisible:document.body.innerText.includes('Conversation through appearance changes')})") { encoded ->
                result.set(JSONObject(JSONArray("[$encoded]").getString(0))
                    .put("appThemeLight", appTheme.data != 0).put("activityThemeLight", activityTheme.data != 0).toString())
                done.countDown()
            }
        }
        assertTrue("The real bundled page must answer", done.await(5, TimeUnit.SECONDS))
        return JSONObject(result.get())
    }
    @Test fun systemAppearanceReachesTheTranscriptAndChangesWhileKeepingTheNativeDraft() {
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 31)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(UiModeManager::class.java)
        val original = if (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)
            UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO
        try {
            NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
                app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
                engine.state(json("startup" to "ready", "connection" to "connected", "pairing" to "idle", "conversationReady" to true, "conversationGeneration" to 7,
                    "laptopId" to "host", "teamId" to "team", "agentId" to "agent",
                    "composerTarget" to ConversationTarget("host", "local", "team", "agent", "session").toJson(),
                    "laptops" to JSONArray().put(json("id" to "host", "name" to "Computer")), "header" to json("title" to "Agent"), "capabilities" to json(),
                    "git" to json("available" to true, "status" to "loaded", "choices" to JSONArray())))
                val snapshot = json("messages" to JSONArray().put(json("id" to "message", "role" to "assistant", "status" to "complete",
                    "parts" to JSONArray().put(json("type" to "text", "text" to "Conversation through appearance changes")))), "turns" to JSONArray(), "activeTurnId" to null, "busy" to false)
                engine.event("conversation", json("agentId" to "agent", "generation" to 7, "ready" to true,
                    "agent" to json("id" to "agent", "teamId" to "team", "name" to "Agent", "backend" to "codex", "status" to json("type" to "idle")),
                    "peers" to JSONArray(), "history" to json("hasOlder" to false), "frame" to json("agentId" to "agent", "backend" to "codex", "payload" to json("snapshot" to snapshot))))
                app.waitUntil(15_000) { engine.model.renderedAgent == "agent" }
                app.onNodeWithTag("composer").performTextInput("Keep this draft through appearance changes")
                for (dark in listOf(true, false)) {
                    manager.setApplicationNightMode(if (dark) UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO)
                    app.waitUntil(5_000) {
                        var matches = false
                        app.activityRule.scenario.onActivity {
                            matches = (it.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) == dark
                        }
                        matches
                    }
                    for (changes in listOf(false, true)) {
                        if (changes) {
                            app.onNodeWithContentDescription("Conversation actions").performClick()
                            app.onNodeWithText("Changes").performClick()
                            app.onNodeWithContentDescription("Close changes").assertIsDisplayed()
                        }
                        // WebView's media-query notification runs outside Compose's clock.
                        var observed = probe(engine, changes)
                        try {
                            app.waitUntil(5_000) {
                                observed = probe(engine, changes)
                                observed.optBoolean("dark") == dark && observed.string("scheme") == if (dark) "dark" else "light"
                            }
                        } finally {
                            android.util.Log.i("AppearanceCheck", "${if (changes) "changes" else "transcript"}: requestedDark=$dark, observed=$observed")
                            assertEquals("Embedded ${if (changes) "changes" else "transcript"} must follow native appearance", dark, observed.getBoolean("dark"))
                        }
                        assertEquals(if (dark) "dark" else "light", observed.getString("scheme"))
                        if (!changes) assertTrue("Appearance changes must preserve the rendered conversation", observed.getBoolean("conversationVisible"))
                        if (changes) app.onNodeWithContentDescription("Close changes").performClick()
                    }
                    app.onNodeWithTag("composer").assertTextContains("Keep this draft through appearance changes")
                }
                assertTrue(engine.commands().none { it.string("type") == "send" })
            }
        } finally { manager.setApplicationNightMode(original) }
    }
}
