package com.nabocorp.companion

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Protects actual Android asset loading, shared transcript rendering and host acknowledgments. */
@RunWith(AndroidJUnit4::class)
class TranscriptWorkflowTest {
    @Test fun nativeHostRendersBundledConversationAndReceivesPaintReceipt() {
        ActivityScenario.launch(CompanionActivity::class.java).use { scenario ->
            val ready = CountDownLatch(1)
            val painted = CountDownLatch(1)
            val receipt = AtomicReference<JSONObject>()
            val document = AtomicReference<String>()
            var page: WebPage? = null
            scenario.onActivity { activity ->
                val product = JSONObject(activity.assets.open("product.json").bufferedReader().use { it.readText() })
                page = WebPage(activity.applicationContext, "transcript", SecureVault(activity), product, { _, message ->
                    val event = if (message is String) JSONObject(message) else message as JSONObject
                    if (event.string("type") == "ready") ready.countDown()
                    if (event.string("type") == "rendered") {
                        receipt.set(event.getJSONObject("receipt"))
                        assertTrue("A paint receipt requires a mounted native view", page!!.view.isAttachedToWindow && page!!.view.height > 0)
                        page!!.view.evaluateJavascript("document.body.innerText") { document.set(it); painted.countDown() }
                    }
                }, { fail("Bundled transcript failed to load") })
            }
            try {
                assertTrue("Bundled transcript must register its native port", ready.await(20, TimeUnit.SECONDS))
                val agent = json("id" to "android-transcript", "teamId" to "test", "name" to "Android transcript", "backend" to "codex", "status" to json("type" to "idle"), "readState" to json("revision" to 3, "readRevision" to 0))
                val snapshot = json("messages" to JSONArray().put(json("id" to "message", "role" to "assistant", "status" to "complete", "parts" to JSONArray().put(json("type" to "text", "text" to "Android transcript verification")))), "turns" to JSONArray(), "activeTurnId" to null, "busy" to false)
                val payload = json("agentId" to "android-transcript", "agent" to agent, "generation" to 7, "ready" to true, "peers" to JSONArray(), "history" to json("hasOlder" to false, "loadingOlder" to false, "failed" to false), "frame" to json("agentId" to "android-transcript", "backend" to "codex", "payload" to json("snapshot" to snapshot)))
                scenario.onActivity {
                    page!!.presentConversation(contextOnly = false, payload.toString())
                    it.setContent { AndroidView(factory = { page!!.view }, modifier = Modifier.fillMaxSize()) }
                }
                assertTrue("Conversation must paint and acknowledge its identity", painted.await(20, TimeUnit.SECONDS))
                assertTrue("Provider content must be visible", document.get().contains("Android transcript verification"))
                assertEquals("android-transcript", receipt.get().getString("agentId"))
                assertEquals(3, receipt.get().getInt("revision"))
                assertEquals(7, receipt.get().getInt("generation"))
                val visible = CountDownLatch(1)
                val height = AtomicReference<String>()
                scenario.onActivity { page!!.view.evaluateJavascript("document.querySelector('.transcript').clientHeight") { height.set(it); visible.countDown() } }
                assertTrue(visible.await(5, TimeUnit.SECONDS))
                assertTrue("Transcript must have a visible viewport after native attachment", height.get().toInt() > 0)
            } finally { scenario.onActivity { page?.destroy() } }
        }
    }
}
