package com.nabocorp.companion

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Platform registration boundary; the controller owns consent, lifecycle and presentation. */
interface PushRegistrationClient {
    fun register()
    fun unregister()
}

class FirebasePushRegistrationClient private constructor(private val context: Context, private val config: JSONObject) : PushRegistrationClient {
    companion object {
        fun create(context: Context, product: JSONObject): PushRegistrationClient? = product.optJSONObject("firebase")
            ?.takeIf { it.string("packageName") == context.packageName }
            ?.let { FirebasePushRegistrationClient(context, it) }
    }
    override fun register() {
        if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
            FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApplicationId(config.getString("appId"))
                .setApiKey(config.getString("apiKey")).setProjectId(config.getString("projectId")).setGcmSenderId(config.getString("senderId")).build())
        }
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = true
        Tasks.await(messaging.register(), 30, TimeUnit.SECONDS)
    }
    override fun unregister() {
        if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) return
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = false
        Tasks.await(messaging.unregister(), 30, TimeUnit.SECONDS)
    }
}
