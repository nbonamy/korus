package com.nabocorp.companion

import android.app.Activity
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/** A scanner is a second native activity. Transferring between visible activities or rotating
 * must not start the lock timeout; a real departure must still relock after its grace period. */
class AppVisibilityTest {
    @Test fun cameraTransfersAndConfigurationChangesKeepOneApplicationForeground() {
        val preferences = InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("visibility-test",0)
        preferences.edit().putBoolean("appLock.enabled",true).commit()
        try {
          InstrumentationRegistry.getInstrumentation().runOnMainSync {
            var clock = 0L
            val lock = AppLock(preferences,{true},{clock})
            lock.unlock {}; lock.authenticationResult(true)
            val visibility = AppVisibility(lock)
            val main = Activity(); val camera = Activity()
            visibility.onActivityStarted(main)
            visibility.onActivityStarted(camera); visibility.onActivityStopped(main)
            clock += 600_000
            visibility.onActivityStarted(main); visibility.onActivityStopped(camera)
            assertFalse(lock.isLocked)
            visibility.onActivityStopped(main)
            clock += 300_000
            visibility.onActivityStarted(main)
            assertTrue(lock.isLocked)
            lock.unlock {}; lock.authenticationResult(true)
            val rotating = object : Activity() { override fun isChangingConfigurations() = true }
            visibility.onActivityStarted(rotating); visibility.onActivityStopped(main)
            visibility.onActivityStopped(rotating)
            clock += 600_000
            visibility.onActivityStarted(Activity())
            assertFalse(lock.isLocked)
          }
        } finally { preferences.edit().clear().commit() }
    }
}
