package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.window.Dialog
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Failure modes: failed enrollment persisted, duplicate prompts, early/late relock,
 * startup disclosure, or a private native dialog surviving above the lock screen.
 * Only the OS authentication result and monotonic clock are substituted. */
class AppLockWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun ownerVerificationGuardsEnrollmentAndLockCoversAnExistingNativeDialog() {
        val preferences = InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("lock-workflow", 0)
        preferences.edit().clear().commit()
        var clock = 0L
        var available = false
        lateinit var lock: AppLock
        val prompts = mutableListOf<String>()
        try {
            app.activityRule.scenario.onActivity { activity ->
                lock = AppLock(preferences, { available }, { clock })
                activity.setContent { MaterialTheme { AppLockSettings(lock) { lock.setEnabled(it, prompts::add) } } }
            }
            app.onNodeWithContentDescription("Lock with device authentication").assertIsNotEnabled()
            app.runOnIdle { available = true; lock.didReturn() }
            app.onNodeWithContentDescription("Lock with device authentication").assertIsEnabled().assertIsOff().performClick().assertIsNotEnabled()
            app.runOnIdle {
                lock.setEnabled(true, prompts::add)
                assertEquals(1, prompts.size)
                lock.authenticationResult(false)
                assertFalse(AppLock(preferences, { true }).isEnabled)
            }
            app.onNodeWithContentDescription("Lock with device authentication").assertIsOff().performClick()
            app.runOnIdle { lock.authenticationResult(true) }
            app.onNodeWithContentDescription("Lock with device authentication").assertIsOn()
            app.activityRule.scenario.onActivity { activity ->
                lock = AppLock(preferences, { true }, { clock })
                assertTrue(lock.isLocked)
                lock.setEnabled(false, prompts::add)
                assertTrue(lock.isEnabled)
                activity.setContent { MaterialTheme {
                    AppLockHost(lock, "Korus", { lock.unlock(prompts::add) }) {
                        Dialog(onDismissRequest = {}) { Text("Private attachment") }
                    }
                } }
            }
            app.onNodeWithText("Private attachment").assertDoesNotExist()
            app.onNodeWithText("Unlock").performClick().assertIsNotEnabled()
            app.runOnIdle { lock.unlock(prompts::add); assertEquals(3, prompts.size); lock.authenticationResult(false) }
            app.onNodeWithText("Private attachment").assertDoesNotExist()
            app.onNodeWithText("Unlock").performClick()
            app.runOnIdle { lock.authenticationResult(true) }
            app.onNodeWithText("Private attachment").assertIsDisplayed()
            app.runOnIdle { lock.didLeave(); clock = 300_000; lock.didReturn() }
            app.onNodeWithText("Private attachment").assertDoesNotExist()
            app.onNodeWithText("Unlock").performClick()
            app.runOnIdle { lock.authenticationResult(true) }
            app.onNodeWithText("Private attachment").assertIsDisplayed()
        } finally { preferences.edit().clear().commit() }
    }

    @Test fun fiveMinuteGraceUsesTheFirstDepartureAndDisabledOrUnsecuredDevicesDoNotLock() {
        val preferences = InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("lock-grace", 0)
        preferences.edit().putBoolean("appLock.enabled", true).commit()
        try {
            app.runOnIdle {
                var clock = 10L
                val lock = AppLock(preferences, { true }, { clock })
                lock.unlock {}; lock.authenticationResult(true)
                lock.didLeave(); clock += 299_999; lock.didReturn()
                assertFalse(lock.isLocked)
                lock.didLeave(); clock += 150_000; lock.didLeave(); clock += 150_000; lock.didReturn()
                assertTrue(lock.isLocked)
                lock.authenticationResult(true) // An unsolicited callback cannot unlock.
                assertTrue(lock.isLocked)
                lock.unlock {}; lock.authenticationResult(true)
                lock.setEnabled(false) { fail("Disabling an unlocked app needs no prompt") }
                assertFalse(AppLock(preferences, { true }).isEnabled)
                lock.didLeave(); clock += 600_000; lock.didReturn()
                assertFalse(lock.isLocked)
                preferences.edit().putBoolean("appLock.enabled", true).commit()
                var available = false
                val unsecured = AppLock(preferences, { available })
                assertFalse(unsecured.canProtect)
                assertFalse(unsecured.isLocked)
                unsecured.setEnabled(true) { fail("A device without a PIN cannot enable app lock") }
                assertFalse(unsecured.isAuthenticating)
                available = true; unsecured.didReturn()
                assertTrue(unsecured.canProtect)
                val secured = AppLock(preferences, { available })
                assertTrue(secured.isLocked)
                available = false; secured.didReturn()
                assertFalse(secured.canProtect)
                assertFalse(secured.isLocked)
            }
        } finally { preferences.edit().clear().commit() }
    }
}
