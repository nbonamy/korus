package com.nabocorp.companion

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** A native-shell fixture replacing only the bundled engine's public state/command port. */
class NativeEngineFixture(private val scenario: ActivityScenario<CompanionActivity>, useActivityModel: Boolean = false) : AutoCloseable {
    private val store = if (useActivityModel) null else ViewModelStore()
    lateinit var model: CompanionModel
        private set
    init {
        scenario.onActivity { activity ->
            val factory = ViewModelProvider.AndroidViewModelFactory.getInstance(activity.application)
            model = if (store != null) ViewModelProvider(store, factory)[CompanionModel::class.java] else ViewModelProvider(activity, factory)[CompanionModel::class.java]
        }
    }
    fun state(value: JSONObject) {
        val event = json("channel" to "engine", "message" to json("type" to "state", "json" to json("type" to "state", "state" to value).toString()))
        scenario.onActivity {
            model.engine.view.evaluateJavascript("window.nativeCommands ??= []; window.companionEngine.dispatch = value => window.nativeCommands.push(JSON.parse(value)); companionNative.postMessage(${JSONObject.quote(event.toString())})", null)
        }
        val deadline = SystemClock.uptimeMillis() + 5000
        var received = false
        while (!received && SystemClock.uptimeMillis() < deadline) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync { received = tree(model.state) == tree(value) }
            if (!received) SystemClock.sleep(25)
        }
        assertTrue("Engine state must cross the native page port", received)
    }
    fun event(type: String, payload: JSONObject) {
        val event = json("channel" to "engine", "message" to json("type" to type, "json" to payload.toString()))
        scenario.onActivity { model.engine.view.evaluateJavascript("companionNative.postMessage(${JSONObject.quote(event.toString())})", null) }
    }
    fun evaluate(script: String): Any? {
        val done = CountDownLatch(1)
        val result = AtomicReference<Any?>()
        scenario.onActivity {
            model.engine.view.evaluateJavascript(script) { encoded ->
                result.set(JSONTokener(encoded).nextValue()); done.countDown()
            }
        }
        assertTrue("The bundled engine must answer the native evaluation", done.await(5, TimeUnit.SECONDS))
        return result.get()
    }
    fun commands(): List<JSONObject> {
        val values = JSONArray(evaluate("JSON.stringify(window.nativeCommands)") as String)
        return (0 until values.length()).map { values.getJSONObject(it) }
    }
    override fun close() { scenario.onActivity { store?.clear() } }
    private fun tree(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { tree(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { tree(value.get(it)) }
        else -> value
    }
}
