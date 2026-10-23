package com.nabocorp.companion

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/** Never substitutes a network recognizer for an unavailable on-device service. No audio is persisted. */
class AndroidDictationCapture(private val context: Context) : DictationCapture {
    private var recognizer: SpeechRecognizer? = null
    override val isAvailable get() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    override fun start(ready: () -> Unit, update: (String) -> Unit, complete: (String?) -> Unit) {
        cancel()
        if (Build.VERSION.SDK_INT < 31 || !isAvailable) throw IllegalStateException(DictationController.UNAVAILABLE)
        val next = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer = next
        fun words(result: Bundle?) { result?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(update) }
        next.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { ready() }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(results: Bundle?) { words(results) }
            override fun onResults(results: Bundle?) { words(results); complete(null) }
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onError(error: Int) { complete(when (error) {
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow microphone access for this app in Android Settings to use dictation."
                SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> DictationController.UNAVAILABLE
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was recognized. Your draft is kept; tap the microphone to try again."
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The microphone is busy. Finish the other recording and try again."
                else -> "Dictation was interrupted. Your words are kept in the draft."
            }) }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        if (Build.VERSION.SDK_INT >= 33) intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
        next.startListening(intent)
    }
    override fun finish() { recognizer?.stopListening() }
    override fun cancel() {
        val previous = recognizer; recognizer = null
        try { previous?.cancel() } finally { previous?.destroy() }
    }
}
