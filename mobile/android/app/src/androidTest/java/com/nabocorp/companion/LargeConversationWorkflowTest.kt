package com.nabocorp.companion

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

/** Image-heavy provider frames must cross both native page ports intact and
 * paint, rather than hang, truncate history or discard the user's draft.
 * Generate fixture pixels in the engine, just as provider data originates there;
 * no screenshots or large synthetic Java-to-engine injection are involved. */
class LargeConversationWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun page(engine: NativeEngineFixture, script: String): Any? {
        val done = CountDownLatch(1); val result = AtomicReference<Any?>()
        app.activityRule.scenario.onActivity {
            engine.model.transcript.view.evaluateJavascript(script) { result.set(JSONTokener(it).nextValue()); done.countDown() }
        }
        assertTrue(done.await(5, TimeUnit.SECONDS)); return result.get()
    }
    @Test fun imageHeavyFrameOverSixteenMegabytesArrivesIntactPaintsAndOpensItsNativeImage() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(json("startup" to "ready", "connection" to "connected", "pairing" to "idle", "conversationReady" to true,
                "conversationGeneration" to 7, "laptopId" to "host", "teamId" to "team", "agentId" to "large-agent",
                "composerTarget" to ConversationTarget("host", "local", "team", "large-agent", "session").toJson(),
                "laptops" to JSONArray().put(json("id" to "host", "name" to "Computer")), "header" to json("title" to "Agent"), "capabilities" to json()))
            app.onNodeWithTag("composer").performTextInput("Keep this large conversation draft")
            app.waitUntil(10_000) { page(engine, "typeof window.companionTranscript?.setConversation === 'function'") == true }
            // Audit the public page input and call the real renderer. Hash equality
            // proves every provider byte survives, independently of DOM virtualization.
            page(engine, """
                (() => {
                    const original = window.companionTranscript.setConversation;
                    window.companionTranscript.setConversation = async value => {
                        const bytes = new TextEncoder().encode(value);
                        const digest = await crypto.subtle.digest('SHA-256', bytes);
                        window.largeFrameReceived = {bytes:bytes.length,hash:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
                        return original(value);
                    };
                    return true;
                })()
            """.trimIndent())
            engine.evaluate("""
                setTimeout(async () => {
                    const canvas = document.createElement('canvas'); canvas.width=1024; canvas.height=1024;
                    const context=canvas.getContext('2d'); const image=context.createImageData(1024,1024);
                    let random=0x12345678;
                    const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random&255;};
                    for(let i=0;i<image.data.length;i+=4){image.data[i]=next();image.data[i+1]=next();image.data[i+2]=next();image.data[i+3]=255;}
                    context.putImageData(image,0,0); const source=canvas.toDataURL('image/png');
                    const messages=Array.from({length:4},(_,i)=>({id:'image-'+i,role:'assistant',status:'complete',parts:[{type:'text',text:'![Large fixture '+i+']('+source+')'}]}));
                    const agent={id:'large-agent',teamId:'team',name:'Agent',backend:'codex',status:{type:'idle'}};
                    const snapshot={messages,turns:[],activeTurnId:null,busy:false};
                    const payload={agentId:agent.id,generation:7,ready:true,agent,peers:[],history:{hasOlder:false},frame:{agentId:agent.id,backend:'codex',payload:{snapshot}}};
                    const value=JSON.stringify(payload); const bytes=new TextEncoder().encode(value);
                    const digest=await crypto.subtle.digest('SHA-256',bytes);
                    window.largeFrameExpected={bytes:bytes.length,hash:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
                    companionNative.postMessage(JSON.stringify({channel:'engine',message:{type:'conversation',json:value}}));
                },0); true;
            """.trimIndent())
            app.waitUntil(30_000) { engine.model.renderedAgent == "large-agent" }
            val expected = engine.evaluate("window.largeFrameExpected") as JSONObject
            val received = page(engine, "window.largeFrameReceived") as JSONObject
            assertTrue("Exercise the screenshot-sized frame boundary", expected.getLong("bytes") > 16 * 1024 * 1024)
            assertEquals(expected.getLong("bytes"), received.getLong("bytes"))
            assertEquals(expected.getString("hash"), received.getString("hash"))
            assertEquals(true, page(engine, "!!document.querySelector('.transcript img[alt^=\"Large fixture\"]')"))
            page(engine, "document.querySelector('.transcript img[alt^=\"Large fixture\"]').click();true")
            app.waitUntil(15_000) { app.onAllNodesWithTag("image-preview").fetchSemanticsNodes().isNotEmpty() }
            app.onNodeWithContentDescription("Close image").performClick()
            app.onNodeWithTag("composer").assertTextContains("Keep this large conversation draft")
            assertTrue(engine.commands().none { it.string("type") == "send" })
            android.util.Log.i("LargeFrameCheck", "bytes=${expected.getLong("bytes")} sha256=${expected.getString("hash")} nativeImageOpened=true draftPreserved=true screenshotsCaptured=false")
        }
    }
}
