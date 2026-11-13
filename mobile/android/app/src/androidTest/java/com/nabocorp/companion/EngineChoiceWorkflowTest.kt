package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The engine list above an empty chat's composer: every engine by name, the chosen one marked, a tap switching to it. */
@RunWith(AndroidJUnit4::class)
class EngineChoiceWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()

    @Test fun listsEveryEngineByNameMarksTheChosenOneAndSwitchesOnTap() {
        val chosen = mutableStateOf("codex")
        val picked = mutableListOf<String>()
        app.activityRule.scenario.onActivity { activity ->
            activity.setContent { MaterialTheme { EngineChoiceList(listOf("codex", "claude", "antigravity", "cursor"), chosen.value) { picked += it; chosen.value = it } } }
        }
        for (name in listOf("Codex", "Claude", "Antigravity", "Cursor")) app.onNodeWithText(name).assertIsDisplayed()
        app.onNodeWithText("Codex").assertIsSelected()
        app.onNodeWithText("Cursor").assertIsNotSelected()
        app.onNodeWithText("Cursor").performClick()
        app.runOnIdle { assertEquals(listOf("cursor"), picked) }
        app.onNodeWithText("Cursor").assertIsSelected()
        app.onNodeWithText("Codex").assertIsNotSelected()
    }
}
