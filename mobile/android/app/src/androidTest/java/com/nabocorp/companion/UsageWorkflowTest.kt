package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Native quota presentation owns retry, connection gating and remaining-percent formatting. */
@RunWith(AndroidJUnit4::class)
class UsageWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun reconnectLoadsUsageAndProviderRetryReplacesItsFailure() {
        val connection = mutableStateOf("disconnected")
        val usage = mutableStateOf(json("status" to "loaded", "providers" to JSONArray().put(json("backend" to "codex", "failed" to false,
            "limits" to json("primary" to json("usedPercent" to 80, "windowDurationMins" to 300), "secondary" to json("usedPercent" to null, "windowDurationMins" to 10080))))))
        var refreshed = 0
        var reconnected = 0
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { MaterialTheme { UsageContent(usage.value, connection.value, { refreshed++ }, { reconnected++ }) } }
        }
        app.onNodeWithText("Computer disconnected").assertIsDisplayed()
        app.onNodeWithText("20% left").assertDoesNotExist()
        app.onNodeWithText("Reconnect").performClick()
        app.runOnIdle { assertEquals(1, reconnected); assertEquals(0, refreshed); connection.value = "connected" }
        app.waitForIdle()
        app.runOnIdle { assertEquals(1, refreshed) }
        app.onNodeWithText("Codex").assertIsDisplayed()
        app.onNodeWithText("5h").assertIsDisplayed()
        app.onNodeWithText("20% left").assertIsDisplayed()
        app.onNodeWithText("Weekly").assertIsDisplayed()
        app.onNodeWithText("Unavailable").assertIsDisplayed()
        app.runOnIdle { usage.value = json("status" to "loaded", "providers" to JSONArray().put(json("backend" to "claude", "limits" to null, "failed" to true))) }
        app.onNodeWithText("Claude").assertIsDisplayed()
        app.onNodeWithText("Couldn’t load usage").assertIsDisplayed()
        app.onNodeWithText("Retry").performClick()
        app.runOnIdle {
            assertEquals(2, refreshed)
            usage.value = json("status" to "loaded", "providers" to JSONArray().put(json("backend" to "claude", "failed" to false,
                "limits" to json("primary" to json("usedPercent" to 40, "windowDurationMins" to 300, "resetsAt" to (System.currentTimeMillis() / 1000.0 + 3600))))))
        }
        app.onNodeWithText("60% left").assertIsDisplayed()
        app.onNodeWithText("Couldn’t load usage").assertDoesNotExist()
        app.onNodeWithText("Resets in ", substring = true).assertIsDisplayed()
    }

    @Test fun loadingAndFailedFetchCannotMasqueradeAsEmptyQuotaData() {
        val usage = mutableStateOf(json("status" to "loading"))
        var refreshed = 0
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { MaterialTheme { UsageContent(usage.value, "connected", { refreshed++ }, {}) } }
        }
        app.onNodeWithText("Loading usage…").assertIsDisplayed()
        app.onNodeWithContentDescription("Refresh usage").assertIsNotEnabled()
        app.runOnIdle { usage.value = json("status" to "failed") }
        app.onNodeWithText("Couldn’t load usage").assertIsDisplayed()
        app.onNodeWithText("Retry").performClick()
        app.runOnIdle { assertEquals(2, refreshed); usage.value = json("status" to "loaded", "providers" to JSONArray()) }
        app.onNodeWithText("No usage limits available.").assertIsDisplayed()
        app.onNodeWithContentDescription("Refresh usage").performClick()
        app.runOnIdle { assertEquals(3, refreshed) }
    }
}
