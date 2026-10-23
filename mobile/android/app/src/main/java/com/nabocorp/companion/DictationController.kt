package com.nabocorp.companion

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*

/** The Activity supplies microphone permission; the OS capture owns audio and recognition. */
interface DictationCapture {
    val isAvailable: Boolean
    fun start(ready: () -> Unit, update: (String) -> Unit, complete: (String?) -> Unit)
    fun finish()
    fun cancel()
}

class DictationController {
    enum class Phase { IDLE, REQUESTING, STARTING, RECORDING, FINISHING }
    companion object {
        const val UNAVAILABLE = "On-device dictation isn’t available for this device or language. Check your device’s speech recognition settings. Android 12 or later is required."
    }
    var phase by mutableStateOf(Phase.IDLE)
        private set
    var error by mutableStateOf<String?>(null)
    val active get() = phase != Phase.IDLE
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0L
    private var capture: DictationCapture? = null
    private var timeout: Runnable? = null

    fun start(text: String, capture: DictationCapture, authorize: ((Boolean) -> Unit) -> Unit, update: (String) -> Unit) {
        if (active) return
        error = null
        if (!capture.isAvailable) { error = UNAVAILABLE; return }
        val id = ++generation
        phase = Phase.REQUESTING
        this.capture = capture
        try {
            authorize { granted ->
                if (generation == id && phase == Phase.REQUESTING) {
                    if (granted) beginCapture(text, capture, update)
                    else { cancel(); error = "Allow microphone access for this app in Android Settings to use dictation." }
                }
            }
        } catch (_: Exception) {
            if (generation == id) { cancel(); error = "Couldn’t request microphone access. Try again." }
        }
    }
    private fun beginCapture(text: String, capture: DictationCapture, update: (String) -> Unit) {
        val id = ++generation
        val prefix = if (text.isEmpty() || text.last().isWhitespace()) text else "$text "
        var draft = text
        phase = Phase.STARTING
        timeout = Runnable {
            if (generation == id) { cancel(); error = "On-device dictation couldn’t start. Check your device’s speech recognition settings. Your draft is kept." }
        }.also { handler.postDelayed(it, 10_000) }
        fun ready() {
            if (generation == id && phase == Phase.STARTING) {
                timeout?.let(handler::removeCallbacks); timeout = null
                phase = Phase.RECORDING
            }
        }
        try {
            capture.start(ready = ::ready, update = { words ->
                if (generation == id && words.isNotBlank()) { ready(); draft = prefix + words.trim(); update(draft) }
            }, complete = { failure ->
                if (generation == id) {
                    if (failure == null && phase == Phase.RECORDING) beginCapture(draft, capture, update)
                    else { cancel(); error = failure }
                }
            })
        } catch (_: Exception) { cancel(); error = "Couldn’t start on-device dictation. Check your microphone and speech recognition settings." }
    }
    /** Release the microphone, allowing the recognizer three seconds to return its final words. */
    fun finish() {
        if (phase != Phase.RECORDING) { cancel(); return }
        phase = Phase.FINISHING
        val id = generation
        timeout = Runnable { if (generation == id) cancel() }.also { handler.postDelayed(it, 3000) }
        try { capture?.finish() } catch (_: Exception) { cancel(); error = "Dictation was interrupted. Your words are kept in the draft." }
    }
    /** Freeze the current draft before sending, navigating, backgrounding or locking. */
    fun cancel() {
        generation++
        timeout?.let(handler::removeCallbacks); timeout = null
        val previous = capture; capture = null
        phase = Phase.IDLE
        previous?.cancel()
    }
}
