package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Native recovery failures: fetch completion hides an unpainted transcript, a stale receipt
 * marks another generation read, rejected/hung rendering never recovers, background time
 * consumes a recovery window, or renderer death loses/replays the native draft. */
class ConversationRecoveryWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(agent: String = "agent") = ConversationTarget("host","local","team",agent,"session-$agent")
    private fun state(agent: String = "agent", fetching: Boolean = false, ready: Boolean = true, connection: String = "connected", error: String = "", generation: Int = 7) = json(
        "startup" to "ready","pairing" to "idle","connection" to connection,"error" to error,"loading" to fetching,"conversationReady" to ready,"conversationGeneration" to generation,
        "laptopId" to "host","teamId" to "team","agentId" to agent,"composerTarget" to target(agent).toJson(),"canSend" to (connection == "connected"),
        "teams" to JSONArray().put(json("id" to "team","name" to "Team")),"laptops" to JSONArray().put(json("id" to "host","name" to "Computer")),"header" to json("title" to "Agent"),"capabilities" to json())
    private fun frame(agent: String = "agent", generation: Int = 7, revision: Int = 3, text: String = "Recovered conversation") = json(
        "agentId" to agent,"agent" to json("id" to agent,"teamId" to "team","name" to "Agent","backend" to "codex","status" to json("type" to "idle"),"readState" to json("revision" to revision,"readRevision" to 0)),
        "generation" to generation,"ready" to true,"peers" to JSONArray(),"history" to json("hasOlder" to false,"loadingOlder" to false,"failed" to false),
        "frame" to json("agentId" to agent,"backend" to "codex","payload" to json("snapshot" to json("messages" to JSONArray().put(json("id" to "message","role" to "assistant","status" to "complete","parts" to JSONArray().put(json("type" to "text","text" to text)))),"turns" to JSONArray(),"activeTurnId" to null,"busy" to false))))
    private fun mount(e: NativeEngineFixture) { app.activityRule.scenario.onActivity { a -> a.setContent { MaterialTheme { CompanionApp(e.model,{},{},{},{},{},{}) } } }; app.runOnIdle { e.model.activity(true) } }
    private fun page(e: NativeEngineFixture, script: String): Any? {
        val done=CountDownLatch(1);val result=AtomicReference<Any?>()
        app.activityRule.scenario.onActivity { e.model.transcript.view.evaluateJavascript(script) { result.set(JSONTokener(it).nextValue());done.countDown() } }
        assertTrue(done.await(5,TimeUnit.SECONDS));return result.get()
    }
    private fun painted(e: NativeEngineFixture, agent: String = "agent") { app.waitUntil(15_000) { e.model.renderedAgent == agent }; app.onNodeWithTag("conversation-loading").assertDoesNotExist() }
    private fun reads(e: NativeEngineFixture) = e.commands().filter { it.string("type") == "read" }

    @Test fun fetchedConversationWaitsForItsOwnReadyPaintReceipt() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state(fetching=true,ready=false));mount(e)
            app.onNodeWithText("Loading conversation…").assertIsDisplayed()
            e.state(state(ready=false));app.onNodeWithText("Loading conversation…").assertIsDisplayed()
            app.activityRule.scenario.onActivity {
                val event=json("channel" to "transcript","message" to json("type" to "rendered","receipt" to json("agentId" to "agent","generation" to 6,"revision" to 99)))
                e.model.transcript.view.evaluateJavascript("companionNative.postMessage(${JSONObject.quote(event.toString())})",null)
            }
            app.waitForIdle();assertTrue(reads(e).isEmpty())
            e.state(state());app.onNodeWithText("Loading conversation…").assertIsDisplayed()
            e.event("conversation",frame());painted(e)
            assertTrue((page(e,"document.body.innerText") as String).contains("Recovered conversation"))
            assertEquals(3,reads(e).last().getInt("revision"));assertEquals(7,reads(e).last().getInt("generation"))
        }
    }

    @Test fun loadFailureRetryRepaintsCachedSelectionAndKeepsTheNativeDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state(ready=false,error="mobile.errors.loadConversation"));mount(e)
            app.onNodeWithTag("composer").performTextInput("Retain this draft");app.onNodeWithTag("composer").assertTextContains("Retain this draft")
            app.onNodeWithText("Couldn’t load this conversation").assertIsDisplayed()
            e.event("conversation",frame())
            app.onNodeWithText("Retry").performClick();app.waitForIdle()
            e.state(state())
            assertEquals("agent",e.commands().last { it.string("type")=="selectAgent" }.string("id"))
            painted(e);app.onNodeWithTag("composer").assertTextContains("Retain this draft")
            assertTrue((page(e,"document.body.innerText") as String).contains("Recovered conversation"))
        }
    }

    @Test fun rejectedRenderingPersistsUntilRetryReloadsTheRealBundledPage() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" };e.state(state());mount(e)
            e.event("conversation",frame());painted(e)
            page(e,"window.companionTranscript.setConversation = () => { throw new Error('Scripted render rejection'); }")
            e.event("conversation",frame(revision=4,text="Latest cached conversation"))
            app.waitUntil(5_000) { app.onAllNodesWithText("Couldn’t load this conversation").fetchSemanticsNodes().size==1 }
            e.state(state());app.onNodeWithText("Couldn’t load this conversation").assertIsDisplayed()
            app.onNodeWithText("Retry").performClick();painted(e)
            assertTrue((page(e,"document.body.innerText") as String).contains("Latest cached conversation"))
        }
    }

    @Test fun connectionNoticeWaitsAcrossRetriesAndPreservesAnAlreadyPaintedTranscript() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" };e.state(state());mount(e);e.event("conversation",frame());painted(e)
            e.state(state(connection="reconnecting"));app.onNodeWithText("Connection lost").assertDoesNotExist()
            Thread.sleep(2_000);e.state(state(connection="error"))
            app.waitUntil(5_000) { app.onAllNodesWithText("Connection lost").fetchSemanticsNodes().size==1 }
            assertTrue((page(e,"document.body.innerText") as String).contains("Recovered conversation"))
            app.onNodeWithTag("conversation-loading").assertDoesNotExist()
            e.state(state(agent="another",connection="reconnecting",ready=false,generation=8))
            app.onNodeWithTag("connection-lost-fullscreen").assertIsDisplayed()
            app.onNodeWithText("Reconnect").performClick();app.waitForIdle();assertEquals("reconnect",e.commands().last().string("type"))
            app.runOnIdle { e.model.activity(false) };Thread.sleep(200)
            app.runOnIdle { e.model.activity(true) };app.onNodeWithText("Connection lost").assertDoesNotExist()
        }
    }

    @Test fun suspendedRendererDoesNotTimeOutInBackgroundAndForegroundStallHasARetry() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" };e.state(state(fetching=true));mount(e)
            // Engine readiness does not imply the separate transcript page has mounted.
            // Confirm the scripted stall is installed before delivering its frame.
            app.waitUntil(10_000) {
                page(e,"(() => { const api = window.companionTranscript; if (typeof api?.setConversation !== 'function') return false; api.setConversation = () => new Promise(() => {}); return true; })()") == true
            }
            e.event("conversation",frame())
            app.runOnIdle { e.model.activity(false) };Thread.sleep(20_500)
            app.onNodeWithText("Couldn’t load this conversation").assertDoesNotExist()
            app.runOnIdle { e.model.activity(true) }
            app.waitUntil(25_000) { app.onAllNodesWithText("Couldn’t load this conversation").fetchSemanticsNodes().size==1 }
            e.state(state());app.onNodeWithText("Retry").performClick();painted(e)
        }
    }

    @Test fun rendererTerminationRecoversWithoutLosingOrReplayingAnUnconfirmedDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" };e.state(state());mount(e);e.event("conversation",frame());painted(e)
            app.onNodeWithTag("composer").performTextInput("Unconfirmed prompt");app.onNodeWithTag("composer").assertTextContains("Unconfirmed prompt")
            app.onNodeWithContentDescription("Send").performClick();app.waitForIdle()
            app.waitUntil(5_000) { e.commands().any { it.string("type")=="send" } }
            assertEquals(1,e.commands().count { it.string("type")=="send" })
            app.runOnIdle {
                assertTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE))
                assertTrue(WebViewCompat.getWebViewRenderProcess(e.model.transcript.view)!!.terminate())
            }
            app.waitUntil(10_000) { app.onAllNodesWithText("Couldn’t restore your connection",substring=true).fetchSemanticsNodes().size==1 }
            app.onNodeWithText("Retry").performClick()
            app.waitUntil(25_000) { app.onAllNodesWithTag("pairing-code").fetchSemanticsNodes().size==1 }
            e.state(state());e.event("conversation",frame());painted(e)
            app.onNodeWithTag("composer").assertTextContains("Unconfirmed prompt")
            app.onNodeWithText("Delivery couldn’t be confirmed.",substring=true).assertIsDisplayed()
            assertTrue(e.commands().none { it.string("type")=="send" })
        }
    }

    @Test fun revokedPairingOffersANewCodeWithoutTreatingItAsATransientDisconnect() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" };e.state(state(connection="revoked",ready=false));mount(e)
            app.onNodeWithTag("pairing-code").assertIsDisplayed().performTextInput("ABCD")
            app.onNodeWithTag("pairing-code").assertTextContains("ABCD")
            e.state(state(connection="revoked",ready=false).put("header",json("title" to "Agent","statusText" to "Idle")))
            app.onNodeWithTag("pairing-code").assertTextContains("ABCD").performTextInput("23EF")
            app.waitUntil(5_000) { e.commands().any { it.string("type")=="pair" } }
            assertEquals("ABCD-23EF",e.commands().last { it.string("type")=="pair" }.string("code"))
        }
    }

    @Test fun sameConversationNotificationRetainsThePaintedReadReceiptButAnotherSessionCannotReuseIt() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup")=="ready" };e.state(state());mount(e);e.event("conversation",frame());painted(e)
            app.onNodeWithContentDescription("Open workspace").performClick()
            app.onNodeWithText("New Agent").assertIsDisplayed()
            assertNull(e.model.attention.visibleTarget)
            fun tap(id: String, owner: ConversationTarget) = app.runOnIdle {
                e.model.attention.tapped(json("id" to id,"target" to owner.toJson(),"kind" to "completed","name" to "Agent","createdAt" to System.currentTimeMillis()).toString())
            }
            tap("already-open",target())
            app.waitUntil(5_000) { e.model.attention.visibleTarget==target() }
            app.onNodeWithText("New Agent").assertIsNotDisplayed()
            assertTrue((page(e,"document.body.innerText") as String).contains("Recovered conversation"))
            assertEquals(7,reads(e).last().getInt("generation"))
            app.runOnIdle { e.model.sheet="settings";e.model.acknowledge() }
            assertNull(e.model.attention.visibleTarget)
            tap("already-open-settings",target())
            app.waitUntil(5_000) { e.model.attention.visibleTarget==target() }
            app.onNodeWithText("Settings").assertDoesNotExist()
            val count=reads(e).size
            tap("new-session",target().copy(sessionId="different-session"))
            assertNull(e.model.attention.visibleTarget)
            e.state(state());assertNull(e.model.attention.visibleTarget)
            assertEquals(count,reads(e).size)
            val opened=e.commands().filter { it.string("type")=="openNotification" }
            assertEquals(3,opened.size)
            assertEquals(target().copy(sessionId="different-session"),ConversationTarget.parse(opened.last().obj("target")))
            e.event("notificationOpenFailed",json())
            app.waitUntil(5_000) { app.onAllNodesWithText("This conversation is no longer available on the paired laptop.").fetchSemanticsNodes().isNotEmpty() }
            app.onNodeWithText("OK").performClick()
            app.waitUntil(5_000) { e.model.attention.visibleTarget==target() }
            assertEquals(7,reads(e).last().getInt("generation"))
        }
    }
}
