package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Pairing failures: remembered computers cannot reconnect, distinct errors give no
 * useful recovery, or a large font and keyboard hide entry, QR scanning or privacy. */
class PairingPresentationWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(error: String = "", pairing: String = "idle", computers: JSONArray = JSONArray()) = json(
        "startup" to "ready", "connection" to "unpaired", "pairing" to pairing, "pairingError" to error, "laptops" to computers, "teams" to JSONArray())
    private fun mount(e: NativeEngineFixture, state: JSONObject, fontScale: Float = 1f) {
        app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }; e.state(state)
        app.activityRule.scenario.onActivity { activity -> activity.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                CompanionTheme { CompanionApp(e.model, {}, {}, {}, {}, {}, {}) }
            }
        } }
    }

    @Test fun savedComputerSelectionUsesItsIdentityAndCannotInterruptPairingApproval() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            val computers = JSONArray().put(json("id" to "host:studio", "name" to "Studio workstation"))
                .put(json("id" to "host:travel", "name" to "Travel laptop"))
            mount(e, state(computers = computers))
            app.onNodeWithText("Studio workstation").assertIsDisplayed()
            app.onNodeWithText("Travel laptop").assertIsDisplayed().performClick()
            fun fields(value: JSONObject) = value.keys().asSequence().associateWith { value.get(it) }
            val expected = mapOf("type" to "connect", "laptopId" to "host:travel")
            app.waitUntil(5_000) { e.commands().lastOrNull()?.let(::fields) == expected }
            assertEquals(expected, fields(e.commands().last()))
            e.state(state(pairing = "awaitingApproval", computers = computers))
            app.onNodeWithText("Studio workstation").assertIsNotEnabled()
            app.onNodeWithText("Travel laptop").assertIsNotEnabled()
            app.onNodeWithTag("pairing-code").assertIsNotEnabled()
            assertEquals(1, e.commands().count { it.string("type") == "connect" })
            assertTrue(e.commands().none { it.string("type") == "pair" })
        }
    }

    @Test fun errorsExplainTheCurrentRecoveryWithoutRetryingOrKeepingStaleMessages() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state())
            val recoveries = listOf("noLaptop" to "showing this code", "codeMismatch" to "did not match", "codeFormat" to "8-character",
                "noRelay" to "Pairing is unavailable", "pairingExpired" to "Pairing expired", "unknown" to "Pairing failed")
            var prior: String? = null
            recoveries.forEach { (key, recovery) ->
                e.state(state(error = "mobile.errors.$key"))
                app.onNodeWithText(recovery, substring = true).performScrollTo().assertIsDisplayed()
                prior?.let { app.onNodeWithText(it, substring = true).assertDoesNotExist() }
                prior = recovery
            }
            e.state(state())
            app.onNodeWithText("Pairing failed", substring = true).assertDoesNotExist()
            assertTrue(e.commands().none { it.string("type") == "pair" })
        }
    }

    @Test fun largeTextAndTheRealKeyboardKeepCodeScannerConnectAndPrivacyReachable() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            mount(e, state(error = "mobile.errors.pairingExpired"), fontScale = 1.6f)
            app.onNodeWithTag("pairing-code").performScrollTo().performClick().performTextInput("AB")
            app.waitUntil(5_000) { ViewCompat.getRootWindowInsets(app.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true }
            app.onNodeWithContentDescription("Scan computer QR code").performScrollTo().assertIsDisplayed()
            app.onNodeWithText("Connect").performScrollTo().assertIsDisplayed().assertIsNotEnabled()
            val privacy = app.onNodeWithText("Privacy Policy").performScrollTo().assertIsDisplayed().getUnclippedBoundsInRoot()
            val root = app.onRoot().getUnclippedBoundsInRoot()
            assertTrue(privacy.left >= root.left && privacy.right <= root.right && privacy.top >= root.top && privacy.bottom <= root.bottom)
            val insets = ViewCompat.getRootWindowInsets(app.activity.window.decorView)!!
            assertTrue("The keyboard stays visible while reaching Privacy", insets.isVisible(WindowInsetsCompat.Type.ime()))
            val keyboardTop = root.bottom.value - insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / app.activity.resources.displayMetrics.density
            assertTrue("Privacy remains above the keyboard", privacy.bottom.value <= keyboardTop + 1f)
            app.onNodeWithTag("pairing-code").performScrollTo().assertTextContains("AB")
            assertTrue(e.commands().none { it.string("type") == "pair" })
            android.util.Log.i("PairingLayoutCheck", json("fontScale" to 1.6, "keyboardVisible" to true, "keyboardTopDp" to keyboardTop,
                "privacyBounds" to privacy.toString(), "rootBounds" to root.toString(), "screenshotsCaptured" to false).toString())
        }
    }
}
