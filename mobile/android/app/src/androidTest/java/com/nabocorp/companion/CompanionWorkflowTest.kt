package com.nabocorp.companion

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A real bundled engine must finish startup and expose a native, accessible pairing screen. */
@RunWith(AndroidJUnit4::class)
class CompanionWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun bundledEngineStartsAndPairingSurvivesActivityRecreation() {
        app.waitUntil(30_000) { app.onAllNodesWithTag("pairing-code").fetchSemanticsNodes().size == 1 }
        app.onNodeWithTag("pairing-code").performTextInput("ab23")
        app.onNodeWithTag("pairing-code").assertTextContains("AB23")
        app.onNodeWithText("Privacy Policy").assertHasClickAction()
        app.activityRule.scenario.recreate()
        app.waitUntil(30_000) { app.onAllNodesWithTag("pairing-code").fetchSemanticsNodes().size == 1 }
        app.onNodeWithTag("pairing-code").assertTextContains("AB23")
    }
}
