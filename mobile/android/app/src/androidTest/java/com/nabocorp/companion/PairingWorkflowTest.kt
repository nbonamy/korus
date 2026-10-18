package com.nabocorp.companion

import android.app.Activity
import android.app.Instrumentation.ActivityResult
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native pairing regressions: unrelated QR text can alter a code, two presentations pair twice,
 * manual completion needs an extra tap, or denied camera access blocks manual entry.
 * Scanner activity results are substituted at the OS boundary; the real app and engine port run. */
class PairingWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(pairing: String = "idle", error: String = "") = json("startup" to "ready", "pairing" to pairing, "pairingError" to error, "laptops" to JSONArray())
    private fun scan(payload: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = instrumentation.addMonitor("com.nabocorp.companion.PairingScannerActivity", ActivityResult(Activity.RESULT_OK, Intent().putExtra("pairingCode",payload)), true)
        try {
            app.onNodeWithContentDescription("Scan laptop QR code").performClick()
            app.waitForIdle()
            assertEquals(1,monitor.hits)
        } finally { instrumentation.removeMonitor(monitor) }
    }
    private fun deniedCamera(block: () -> Unit) {
        val permission = android.Manifest.permission.CAMERA
        val packageName = app.activity.packageName
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assertEquals("Verification starts without camera consent",PackageManager.PERMISSION_DENIED,app.activity.checkSelfPermission(permission))
        fun flags(action: String) {
            instrumentation.uiAutomation.executeShellCommand("pm $action $packageName $permission user-fixed").use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
            }
        }
        flags("set-permission-flags")
        try { block() } finally { flags("clear-permission-flags") }
    }

    @Test fun scannerResultsValidateWholePayloadAndOnlyPairOnceAfterAcceptance() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            app.onNodeWithTag("pairing-code").performTextInput("ab")
            scan("https://example.com/ABCD-23EF")
            app.onNodeWithTag("pairing-code").assertTextContains("AB")
            assertTrue(engine.commands().none { it.string("type") == "pair" })
            scan(" abcd23ef\n")
            app.onNodeWithTag("pairing-code").assertTextContains("ABCD-23EF")
            val sent = engine.commands().single { it.string("type") == "pair" }
            assertEquals(setOf("type","code","deviceName"),sent.keys().asSequence().toSet())
            assertEquals("ABCD-23EF",sent.string("code")); assertEquals(Build.MODEL,sent.string("deviceName"))
            app.onNodeWithContentDescription("Scan laptop QR code").assertIsNotEnabled()
            app.onNodeWithTag("pairing-code").assertIsNotEnabled()
        }
    }

    @Test fun manualEntryFormatsAndAutoSubmitsOnceAndAnErrorRequiresExplicitRetry() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            app.onNodeWithTag("pairing-code").performTextInput("ab 0i23")
            app.onNodeWithTag("pairing-code").assertTextContains("AB23")
            app.onNodeWithTag("pairing-code").performTextReplacement("abcd23ef")
            app.onNodeWithTag("pairing-code").assertTextContains("ABCD-23EF")
            assertEquals(1,engine.commands().count { it.string("type") == "pair" })
            engine.state(state("searching")); engine.state(state("awaitingApproval"))
            app.onNodeWithContentDescription("Scan laptop QR code").assertIsNotEnabled()
            app.activityRule.scenario.recreate()
            app.onNodeWithTag("pairing-code").assertTextContains("ABCD-23EF")
            app.onNodeWithTag("pairing-code").assertIsNotEnabled()
            engine.state(state(error = "mobile.errors.noLaptop"))
            assertEquals(1,engine.commands().count { it.string("type") == "pair" })
            app.onNodeWithTag("pairing-code").performTextReplacement("abcd23e")
            assertEquals(1,engine.commands().count { it.string("type") == "pair" })
            app.onNodeWithTag("pairing-code").performTextReplacement("abcd23ef")
            assertEquals(2,engine.commands().count { it.string("type") == "pair" })
        }
    }

    @Test fun cameraDenialOffersManualEntryWithoutSendingAPairingRequest() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state())
            app.onNodeWithContentDescription("Scan laptop QR code").assertIsDisplayed()
            deniedCamera {
                app.onNodeWithContentDescription("Scan laptop QR code").performClick()
                app.waitUntil(10_000) { app.onAllNodesWithText("Camera unavailable").fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty() }
                app.onNodeWithText("Open Settings").assertIsDisplayed()
                app.onNodeWithText("Enter code manually").performClick()
                app.onNodeWithTag("pairing-code").assertIsDisplayed().performTextInput("AB")
                assertTrue(engine.commands().none { it.string("type") == "pair" })
            }
        }
    }

    @Test fun photoPermissionDenialDoesNotLaunchCaptureAndRestoresTheComposer() {
        NativeEngineFixture(app.activityRule.scenario, useActivityModel = true).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(json("startup" to "ready", "connection" to "connected", "laptops" to JSONArray().put(json("id" to "host")), "agentId" to "agent",
                "composerTarget" to ConversationTarget("host","local","team","agent","session").toJson(),"canSend" to true,"capabilities" to json("attachments" to true)))
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val monitor = instrumentation.addMonitor(android.content.IntentFilter(android.provider.MediaStore.ACTION_IMAGE_CAPTURE),ActivityResult(Activity.RESULT_CANCELED,null),true)
            try {
                deniedCamera {
                    app.onNodeWithContentDescription("Add").performClick()
                    app.onNodeWithText("Take Photo").performClick()
                    app.waitUntil(5000) { !engine.model.composerDrafts.importing }
                    assertEquals(0,monitor.hits)
                    app.onNodeWithText("Allow camera access",substring = true).assertIsDisplayed()
                    app.onNodeWithTag("composer").performTextInput("Manual message")
                    assertTrue(engine.model.composerDrafts.items.isEmpty())
                }
            } finally { instrumentation.removeMonitor(monitor) }
        }
    }
}
