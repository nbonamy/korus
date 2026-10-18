package com.nabocorp.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import org.junit.runner.RunWith

/** An ordinary build without operator Firebase configuration must not initialize a Google client. */
@RunWith(AndroidJUnit4::class)
class PushSetupTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private var enabled = false
    @Before fun saveConsent() {
        val preferences = context.getSharedPreferences("preferences", 0)
        enabled = preferences.getBoolean("notifications.enabled", false)
        preferences.edit().putBoolean("notifications.enabled", false).commit()
    }
    @After fun restoreConsent() { context.getSharedPreferences("preferences", 0).edit().putBoolean("notifications.enabled", enabled).commit() }
    @Test fun unavailablePushLeavesTheCompanionUsableAndDoesNotInitializeFirebase() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.runOnMainSync {
            val app = context.applicationContext as CompanionApplication
            assertFalse(app.push.configured)
            app.push.enable()
            assertEquals("Notifications unavailable", app.push.status)
            assertTrue(FirebaseApp.getApps(context).isEmpty())
            assertFalse(app.attention.systemEnabled)
        }
    }

    // Registration refreshes must reach the engine even if Google returns the same token:
    // signed consent expires, and a failed relay registration must be retryable.
    @Test fun refreshingAnExistingTokenRenewsConsentAndDisablingRevokesIt() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.runOnMainSync {
            val attention = AttentionNotifications(context)
            val push = PushNotifications(context, attention, object : PushRegistrationClient { override fun register() {}; override fun unregister() {} })
            val registrations = mutableListOf<String?>()
            val stop = push.observe { registrations.add(it?.string("token")) }
            attention.systemEnabled = true
            push.tokenChanged("first-token")
            push.tokenChanged("first-token")
            push.tokenChanged("rotated-token")
            push.disable()
            push.tokenChanged("late-token")
            assertEquals(listOf(null, "first-token", "first-token", "rotated-token", null), registrations)
            stop()
        }
    }

    @Test fun cachedFirebaseRegistrationAndRevocationDoNotRunOnTheUiThread() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val registered = CountDownLatch(1)
        val revoked = CountDownLatch(1)
        lateinit var push: PushNotifications
        instrumentation.runOnMainSync {
            push = PushNotifications(context, AttentionNotifications(context), object : PushRegistrationClient {
                override fun register() { try { Tasks.await(Tasks.forResult(null)) } finally { registered.countDown() } }
                override fun unregister() { try { Tasks.await(Tasks.forResult(null)) } finally { revoked.countDown() } }
            })
            push.enable()
        }
        assertTrue(registered.await(5, TimeUnit.SECONDS))
        instrumentation.runOnMainSync {
            assertNull("Cached FCM registration must not fail its main-thread guard", push.error)
            push.disable()
        }
        assertTrue(revoked.await(5, TimeUnit.SECONDS))
        instrumentation.runOnMainSync { assertEquals("Enable notifications", push.status) }
    }

    @Test fun disablingDuringRegistrationIgnoresLateFailureAndRevokesTheClient() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val revoked = CountDownLatch(1)
        lateinit var push: PushNotifications
        instrumentation.runOnMainSync {
            push = PushNotifications(context, AttentionNotifications(context), object : PushRegistrationClient {
                override fun register() { started.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); throw java.io.IOException("SERVICE_NOT_AVAILABLE") }
                override fun unregister() { revoked.countDown() }
            })
            push.enable()
        }
        try {
            assertTrue(started.await(5, TimeUnit.SECONDS))
            instrumentation.runOnMainSync { push.disable() }
        } finally { release.countDown() }
        assertTrue(revoked.await(5, TimeUnit.SECONDS))
        instrumentation.runOnMainSync { assertNull(push.error); assertEquals("Enable notifications", push.status) }
    }
}
