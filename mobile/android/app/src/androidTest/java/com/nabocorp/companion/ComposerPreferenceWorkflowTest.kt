package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test

class ComposerPreferenceWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    @Test fun followUpChoiceSurvivesARecreatedNativeModel() {
        val preferences = InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("preferences", 0)
        val previous = preferences.getString("composer.followUpBehavior", null)
        preferences.edit().remove("composer.followUpBehavior").commit()
        try {
            NativeEngineFixture(app.activityRule.scenario).use { first ->
                app.activityRule.scenario.onActivity { activity ->
                    first.model.sheet = "settings"
                    activity.setContent { MaterialTheme { SheetContent(first.model, {}, {}) } }
                }
                app.onNodeWithText("Steer").performScrollTo().assertIsDisplayed()
                app.onNodeWithText("Follow-up behavior").performClick()
                app.onNode(hasText("Queue") and hasAnyAncestor(isPopup())).performClick()
                app.onNodeWithText("Queue").assertIsDisplayed()
            }
            NativeEngineFixture(app.activityRule.scenario).use { second ->
                app.activityRule.scenario.onActivity { activity ->
                    second.model.sheet = "settings"
                    activity.setContent { MaterialTheme { SheetContent(second.model, {}, {}) } }
                }
                app.onNodeWithText("Queue").performScrollTo().assertIsDisplayed()
                app.onNodeWithText("Follow-up behavior").performClick()
                app.onNode(hasText("Steer") and hasAnyAncestor(isPopup())).performClick()
                app.onNodeWithText("Steer").assertIsDisplayed()
            }
        } finally { preferences.edit().putString("composer.followUpBehavior", previous).commit() }
    }
}
