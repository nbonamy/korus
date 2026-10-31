package com.nabocorp.companion

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.MutableContextWrapper
import android.content.res.Configuration
import android.net.Uri
import android.os.SystemClock
import android.view.ContextThemeWrapper
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.compose.runtime.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** A single bundled page with a main-frame, origin-scoped message port. No generic Java bridge. */
@SuppressLint("SetJavaScriptEnabled")
class WebPage(
    context: Context,
    private val page: String,
    private val vault: SecureVault,
    private val product: JSONObject,
    private val receive: (String, Any?) -> Unit,
    private val failed: () -> Unit,
    private val active: () -> Boolean = { true },
) {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        private val imageCacheWork = Executors.newSingleThreadExecutor()
    }
    private val imageCache = DeviceImageCache(File(context.cacheDir, "ConversationImages/v1"))
    val url = "$ORIGIN/assets/web/$page.html"
    private val application = context.applicationContext
    private var configuration = Configuration(context.resources.configuration)
    private fun themedContext(value: Configuration) = ContextThemeWrapper(application.createConfigurationContext(value), application.applicationInfo.theme)
    private val viewContext = MutableContextWrapper(themedContext(configuration))
    val view = WebView(viewContext)
    var usable by mutableStateOf(true)
        private set
    private var closed = false
    private var pageReady = false
    private var presentationEpoch = 0
    private var presentation: (() -> Unit)? = null
    private var waitingSince: Long? = null
    private val watchdog = object : Runnable {
        override fun run() {
            if (!usable) return
            val now = SystemClock.elapsedRealtime()
            if (!active() || !view.isAttachedToWindow || !view.isShown) waitingSince = null
            else if (waitingSince == null) waitingSince = now
            else if (now - waitingSince!! >= 20_000) { fail(); return }
            view.postDelayed(this,1_000)
        }
    }
    private fun waitForPage() { stopWaiting(); view.postDelayed(watchdog,1_000) }
    private fun stopWaiting() { view.removeCallbacks(watchdog); waitingSince = null }
    /** Retained pages follow the native window's configuration without retaining
     * its Activity or reloading the engine and provider-owned conversation. */
    fun configure(value: Configuration) {
        if (configuration == value || closed) return
        configuration = Configuration(value)
        viewContext.baseContext = themedContext(configuration)
        view.dispatchConfigurationChanged(configuration)
    }
    fun activityChanged() { waitingSince = null }
    fun beginSelection() {
        presentationEpoch++; presentation = null; stopWaiting()
        if (!pageReady && usable) waitForPage()
    }
    private fun fail() {
        if (!usable || closed) return
        destroy(); failed()
    }
    init {
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
        }
        view.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> view.postOnAnimation { presentIfVisible() } }
        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) { view.postOnAnimation { presentIfVisible() } }
            override fun onViewDetachedFromWindow(view: View) = Unit
        })
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.e("CompanionWeb", "$page: ${message.message()}")
                }
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(webView: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(webView: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString() == url) return false
                if (request.isForMainFrame && request.hasGesture()) openExternal(context, request.url.toString())
                return true
            }
            override fun onReceivedError(webView: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) fail()
            }
            override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
                fail(); return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, "companionNative", setOf(ORIGIN)) { webView, message, origin, mainFrame, reply ->
                if (!usable || !mainFrame || origin.toString() != ORIGIN || webView.url != url) return@addWebMessageListener
                try {
                    val envelope = JSONObject(message.data ?: return@addWebMessageListener)
                    val channel = envelope.optString("channel")
                    if (channel == "native") {
                        val id = envelope.getString("id")
                        val result = JSONObject().put("id", id)
                        try {
                            require(page == "engine")
                            val body = envelope.getJSONObject("message")
                            if (body.getString("type").startsWith("imageCache.")) {
                                val type = body.getString("type"); val host = body.getString("host")
                                val key = body.optString("key"); val dataUrl = body.optString("dataUrl")
                                imageCacheWork.execute {
                                    try {
                                        val value: Any? = when (type) {
                                            "imageCache.read" -> imageCache.read(host, key)
                                            "imageCache.write" -> { imageCache.write(host, key, dataUrl); true }
                                            "imageCache.forget" -> { imageCache.forget(host); true }
                                            else -> throw IllegalArgumentException()
                                        }
                                        result.put("result", value ?: JSONObject.NULL)
                                    } catch (_: Exception) { result.put("error", "Image cache is unavailable.") }
                                    webView.post { if (usable) reply.postMessage(result.toString()) }
                                }
                                return@addWebMessageListener
                            }
                            val value: Any? = when (body.getString("type")) {
                                "relay" -> JSONObject(product.getJSONObject("relay").toString()).apply { if (BuildConfig.DEBUG) put("allowLocalDevelopment", true) }
                                "vault.read" -> JSONObject().put("value", vault.read(body.getString("key")) ?: JSONObject.NULL)
                                "vault.write" -> vault.write(body.getString("key"), body.getString("value"))
                                "vault.remove" -> vault.remove(body.getString("key"))
                                "connection.diagnostic" -> true
                                else -> throw IllegalArgumentException()
                            }
                            result.put("result", value ?: JSONObject.NULL)
                        } catch (_: Exception) { result.put("error", "Device storage or configuration is unavailable.") }
                        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(result.toString())
                    } else if (channel == page) {
                        val event = envelope.optJSONObject("message") ?: runCatching { JSONObject(envelope.optString("message")) }.getOrNull()
                        if (event?.has("nativePresentation") == true) {
                            if (event.optInt("nativePresentation") != presentationEpoch) return@addWebMessageListener
                            stopWaiting()
                            if (event.string("type") == "renderFailed") { fail(); return@addWebMessageListener }
                        }
                        if (event?.string("type") == "ready") { pageReady = true; stopWaiting() }
                        if (BuildConfig.DEBUG) {
                            android.util.Log.d("CompanionBridge", "$page: ${event?.optString("type")}")
                        }
                        receive(channel, envelope.opt("message"))
                    }
                } catch (_: Exception) { /* Malformed messages grant no native access. */ }
            }
        } else view.post { fail() }
        waitForPage()
        view.loadUrl(url)
    }
    fun call(objectName: String, method: String, json: String? = null, done: ((String?) -> Unit)? = null) {
        if (!usable) { done?.invoke(null); return }
        val args = json?.let { JSONObject.quote(it) } ?: ""
        view.evaluateJavascript("window.$objectName?.$method($args)") { done?.invoke(it) }
    }
    /** A detached WebView can run animation callbacks while its CSS viewport is still zero. */
    fun presentConversation(contextOnly: Boolean, json: String) {
        require(page == "transcript")
        if (!usable) return
        val method = if (contextOnly) "setContext" else "setConversation"
        val epoch = ++presentationEpoch
        presentation = {
            waitForPage()
            view.evaluateJavascript("Promise.resolve().then(() => window.companionTranscript.$method(${JSONObject.quote(json)})).then(receipt => companionNative.postMessage(JSON.stringify({channel:'transcript',message:JSON.stringify({type:'rendered',nativePresentation:$epoch,receipt})}))).catch(() => companionNative.postMessage(JSON.stringify({channel:'transcript',message:JSON.stringify({type:'renderFailed',nativePresentation:$epoch})})))", null)
        }
        presentIfVisible()
    }
    private fun presentIfVisible() {
        if (!usable || !view.isAttachedToWindow || !view.isShown || view.width == 0 || view.height == 0) return
        val present = presentation ?: return
        presentation = null
        present()
    }
    fun destroy() {
        if (closed) return
        closed = true; usable = false; stopWaiting(); presentationEpoch++
        presentation = null
        (view.parent as? ViewGroup)?.removeView(view)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(view, "companionNative")
        view.destroy()
    }
}

fun openExternal(context: Context, value: String) {
    val uri = Uri.parse(value)
    if (uri.scheme !in setOf("https", "http", "mailto")) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
