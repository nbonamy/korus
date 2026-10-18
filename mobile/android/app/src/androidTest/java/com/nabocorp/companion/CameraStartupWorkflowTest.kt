package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import org.junit.Rule
import org.junit.Test

/** A camera HAL can open without delivering a preview. The native readiness deadline must
 * recover, cancel after readiness, and count only a resumed scanner's time. Real camera
 * startup cannot reliably reproduce all three outcomes; only readiness is supplied here. */
class CameraStartupWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    @Test fun readinessAndBackgroundingCancelTheDeadlineAndAStalledPreviewRecovers() {
        val ready = mutableStateOf(false)
        val failed = mutableStateOf(false)
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme {
            if (failed.value) Text("Camera unavailable") else CameraStartupIndicator(activity,ready.value,{ failed.value = true })
        } } }
        app.waitForIdle()
        app.mainClock.autoAdvance = false
        try {
            app.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            app.mainClock.advanceTimeByFrame(); app.waitForIdle()
            app.mainClock.advanceTimeBy(10_250)
            app.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            app.mainClock.advanceTimeByFrame(); app.waitForIdle()
            app.onNodeWithText("Camera unavailable").assertDoesNotExist()
            app.runOnIdle { ready.value = true }
            app.mainClock.advanceTimeByFrame(); app.waitForIdle()
            app.mainClock.advanceTimeBy(10_250)
            app.onNodeWithText("Camera unavailable").assertDoesNotExist()
            app.runOnIdle { ready.value = false }
            app.mainClock.advanceTimeByFrame(); app.waitForIdle()
            app.mainClock.advanceTimeBy(9_000)
            app.onNodeWithText("Camera unavailable").assertDoesNotExist()
            app.mainClock.advanceTimeBy(1_500)
            app.onNodeWithText("Camera unavailable").assertIsDisplayed()
        } finally { app.mainClock.autoAdvance = true }
    }
}
