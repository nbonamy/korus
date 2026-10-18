package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import android.util.Base64
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Real transcript/native viewer failures: image clicks disappear, zoom cannot reset,
 * stale/locked events disclose another conversation, unsafe sources reach a loader,
 * invalid remote responses decode, or retry never fetches fresh image bytes. */
class ImagePreviewWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private val png by lazy {
        val bitmap = android.graphics.Bitmap.createBitmap(600,360,android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.rgb(18,30,48))
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        paint.color=android.graphics.Color.rgb(85,170,255);canvas.drawRoundRect(40f,40f,560f,320f,24f,24f,paint)
        paint.color=android.graphics.Color.WHITE;paint.textSize=48f;canvas.drawText("Launch image",80f,190f,paint)
        val output=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);bitmap.recycle()
        Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP)
    }
    private fun state(agent: String = "agent") = json("startup" to "ready", "pairing" to "idle", "connection" to "connected", "conversationReady" to true,
        "conversationGeneration" to 7, "laptopId" to "host", "teamId" to "team", "agentId" to agent,
        "composerTarget" to ConversationTarget("host","local","team",agent,"session-$agent").toJson(),
        "laptops" to JSONArray().put(json("id" to "host", "name" to "Computer")), "header" to json("title" to "Agent"), "capabilities" to json())
    private fun mount(e: NativeEngineFixture) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state())
        app.activityRule.scenario.onActivity { a -> a.setContent { CompanionTheme { CompanionApp(e.model,{},{},{},{},{},{}) } } }
        app.runOnIdle { e.model.activity(true) }
    }
    private fun page(e: NativeEngineFixture, script: String): Any? {
        val done = CountDownLatch(1); val result = AtomicReference<Any?>()
        app.activityRule.scenario.onActivity { e.model.transcript.view.evaluateJavascript(script) { result.set(JSONTokener(it).nextValue()); done.countDown() } }
        assertTrue(done.await(5,TimeUnit.SECONDS)); return result.get()
    }
    private fun open(e: NativeEngineFixture, source: String, agent: String = "agent", title: String = "Preview") {
        val event = json("channel" to "transcript", "message" to json("type" to "openImage", "agentId" to agent, "title" to title, "src" to source))
        page(e, "companionNative.postMessage(${JSONObject.quote(event.toString())})")
    }
    private fun waitImage(title: String) { app.waitUntil(10_000) { app.onAllNodesWithTag("image-preview").fetchSemanticsNodes().isNotEmpty() }; app.onNodeWithContentDescription(title).assertIsDisplayed() }
    private fun waitFailure() { app.waitUntil(10_000) { app.onAllNodesWithText("Image unavailable").fetchSemanticsNodes().isNotEmpty() } }
    private fun waitViewerLayout() {
        // System keyboard/inset animations run outside Compose's test clock. Check
        // the final viewport, so a transient zoom before a later reset cannot pass.
        app.onNodeWithTag("image-preview").awaitStableBounds(app)
    }

    @Test fun renderedConversationImageOpensZoomsAndDismissesWithoutChangingTheDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e)
            app.onNodeWithTag("composer").performTextInput("Keep my draft")
            val snapshot = json("messages" to JSONArray().put(json("id" to "message", "role" to "assistant", "status" to "complete", "parts" to JSONArray().put(json("type" to "text", "text" to "![Launch image](data:image/png;base64,$png)")))), "turns" to JSONArray(), "activeTurnId" to null, "busy" to false)
            e.event("conversation",json("agentId" to "agent", "generation" to 7, "ready" to true, "agent" to json("id" to "agent", "teamId" to "team", "name" to "Agent", "backend" to "codex", "status" to json("type" to "idle")), "peers" to JSONArray(), "history" to json("hasOlder" to false), "frame" to json("agentId" to "agent", "backend" to "codex", "payload" to json("snapshot" to snapshot))))
            app.waitUntil(15_000) { e.model.renderedAgent == "agent" }
            assertEquals(true,page(e,"!!document.querySelector('.transcript img[alt=\"Launch image\"]')"))
            page(e,"document.querySelector('.transcript img[alt=\"Launch image\"]').click()")
            waitImage("Launch image")
            app.onNodeWithTag("image-preview").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"100%"))
                .performTouchInput { doubleClick() }
            waitViewerLayout()
            app.onNodeWithTag("image-preview").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"300%"))
                .performTouchInput { doubleClick() }
            waitViewerLayout()
            app.onNodeWithTag("image-preview").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"100%"))
            app.onNodeWithContentDescription("Close image").performClick()
            app.onNodeWithTag("image-preview").assertDoesNotExist(); app.onNodeWithTag("composer").assertTextContains("Keep my draft")
            assertTrue(e.commands().none { it.string("type") == "send" })
        }
    }

    @Test fun nativeViewerRejectsUnsafeBytesAndLateConversationOrLockedEvents() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e)
            for (source in listOf("file:///etc/passwd", "content://private/photo", "javascript:alert(1)", "https://user:pass@example.test/photo.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,%%%", "data:image/png;base64,")) {
                open(e,source); waitFailure(); app.onNodeWithContentDescription("Close image").performClick()
            }
            open(e,"data:image/png;base64,$png",agent="other");app.waitForIdle();app.onNodeWithContentDescription("Close image").assertDoesNotExist()
            app.runOnIdle { e.model.setUnlocked(false) }
            open(e,"data:image/png;base64,$png");app.waitForIdle();app.onNodeWithContentDescription("Close image").assertDoesNotExist()
            app.runOnIdle { e.model.setUnlocked(true) }
            open(e,"data:image/png;base64,$png");waitImage("Preview")
            e.state(state("another"));app.onNodeWithContentDescription("Close image").assertDoesNotExist()
        }
    }

    @Test fun remoteFailuresHaveAFreshRetryAndRespectResponseBoundsAndType() {
        val requests = AtomicInteger(); val response = AtomicInteger(0)
        ServerSocket(0).use { server ->
            val worker = thread(isDaemon=true) {
                while (!server.isClosed) try { server.accept().use { socket ->
                    val input=socket.getInputStream().bufferedReader(); while (!input.readLine().isNullOrBlank()) { }
                    requests.incrementAndGet()
                    val mode=response.get();val bytes=if(mode==1) Base64.decode(png,Base64.DEFAULT) else byteArrayOf(0)
                    val status=if(mode==0) "503 Unavailable" else "200 OK"
                    val type=if(mode==2) "text/html" else "image/png"
                    val length=if(mode==3) 20_000_001 else bytes.size
                    socket.getOutputStream().apply { write("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: $length\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush() }
                } } catch (_: Exception) { if(server.isClosed) break }
            }
            try { NativeEngineFixture(app.activityRule.scenario).use { e ->
                mount(e);val url="http://127.0.0.1:${server.localPort}/image.png"
                open(e,url);waitFailure();assertEquals(1,requests.get())
                response.set(1);app.onNodeWithText("Retry").performClick();waitImage("Preview");assertEquals(2,requests.get())
                app.onNodeWithContentDescription("Close image").performClick()
                for(mode in listOf(2,3)) { response.set(mode);open(e,url);waitFailure();app.onNodeWithContentDescription("Close image").performClick() }
                assertEquals(4,requests.get())
            } } finally { server.close();worker.join(2_000) }
        }
    }
}
