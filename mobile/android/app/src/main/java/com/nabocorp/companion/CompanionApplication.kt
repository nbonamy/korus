package com.nabocorp.companion

import android.app.Application
import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class CompanionApplication : Application() {
    lateinit var appLock: AppLock
        private set
    lateinit var attention: AttentionNotifications
        private set
    lateinit var push: PushNotifications
        private set
    override fun onCreate() {
        super.onCreate()
        appLock = AppLock(getSharedPreferences("preferences", 0), { getSystemService(android.app.KeyguardManager::class.java).isDeviceSecure })
        registerActivityLifecycleCallbacks(AppVisibility(appLock))
        attention = AttentionNotifications(this)
        val product = JSONObject(assets.open("product.json").bufferedReader().use { it.readText() })
        push = PushNotifications(this, attention, FirebasePushRegistrationClient.create(this, product))
        push.refresh()
    }
}

/** FCM delivers data-only messages so the app owns foreground and background presentation alike. */
@SuppressLint("MissingFirebaseInstanceTokenRefresh") // FCM installation-ID mode uses onRegistered, not the deprecated onNewToken callback.
class CompanionMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        Handler(Looper.getMainLooper()).post { (application as CompanionApplication).push.tokenChanged(installationId) }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.data[AttentionNotifications.EXTRA_NOTIFICATION] ?: message.data["notification"] ?: return
        Handler(Looper.getMainLooper()).post { (application as CompanionApplication).attention.receive(notification) }
    }
}
