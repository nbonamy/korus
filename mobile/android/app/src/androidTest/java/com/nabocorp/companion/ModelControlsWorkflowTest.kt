package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Model/reasoning and speed choices must use offered catalog identifiers and explicit null for
 * Standard service, without leaking an unavailable or disconnected choice into the engine. */
class ModelControlsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(model: String = "first", effort: String = "high", tier: String? = null, next: String? = "priority", connected: Boolean = true) = json(
        "startup" to "ready", "connection" to if (connected) "connected" else "reconnecting", "agentId" to "agent", "canSend" to connected,
        "composerTarget" to ConversationTarget("host","local","team","agent","session").toJson(), "laptops" to JSONArray().put(json("id" to "host")),
        "capabilities" to json("serviceTier" to true, "reasoningEffort" to true),
        "composer" to json("modelId" to model, "effort" to effort, "serviceTier" to tier,
            "speedTiers" to JSONArray(if (model == "first") listOf("priority", "ultrafast") else listOf()), "nextServiceTier" to next),
        "models" to JSONArray().put(json("id" to "first", "name" to "First model", "efforts" to JSONArray(listOf("high","low")),
            "tiers" to JSONArray().put(json("id" to "priority", "name" to "Fast")).put(json("id" to "ultrafast", "name" to "Ultrafast"))))
            .put(json("id" to "second", "name" to "Second model", "efforts" to JSONArray(listOf("medium")), "tiers" to JSONArray())))
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } } }
        app.onNodeWithTag("composer").performClick()
    }
    private fun change(engine: NativeEngineFixture): JSONObject = engine.commands().last { it.string("type") == "composer" }.obj("change")
    private fun speed(description: String) = app.onNode(hasContentDescription("Speed") and SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, description))

    @Test fun speedButtonStepsThroughTheOfferedTiersAndBackToStandardWithExplicitNull() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            speed("Standard").performClick()
            assertEquals("{\"serviceTier\":\"priority\"}", change(engine).toString())
            engine.state(state(tier = "priority", next = "ultrafast"))
            speed("Fast").performClick()
            assertEquals("{\"serviceTier\":\"ultrafast\"}", change(engine).toString())
            engine.state(state(tier = "ultrafast", next = null))
            speed("Ultrafast").performClick()
            assertTrue(change(engine).has("serviceTier")); assertTrue(change(engine).isNull("serviceTier"))
            engine.state(state(connected = false))
            app.onNodeWithContentDescription("Speed").assertIsNotEnabled()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsNotEnabled()
            engine.state(state().put("capabilities", json("serviceTier" to false, "reasoningEffort" to true)))
            app.onNodeWithContentDescription("Speed").assertDoesNotExist()
            engine.state(state(model = "second", effort = "medium", next = null))
            app.onNodeWithContentDescription("Speed").assertDoesNotExist()
        }
    }

    @Test fun modelPickerShowsCurrentReasoningAndOffersOnlyTheSelectedModelsEfforts() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            app.onNodeWithContentDescription("Choose model and reasoning").assertTextContains("High", substring = true).performClick()
            app.onNodeWithText("Low").performScrollTo().awaitStableBounds(app).performClick()
            assertEquals("{\"reasoningEffort\":\"low\"}", change(engine).toString())
            engine.state(state(effort = "low"))
            app.onNodeWithTag("composer").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").assertTextContains("Low", substring = true).performClick()
            app.onNodeWithText("Second model").awaitStableBounds(app).performClick()
            assertEquals("{\"modelId\":\"second\"}", change(engine).toString())
            engine.state(state(model = "second", effort = "medium"))
            app.onNodeWithTag("composer").performClick()
            app.onNodeWithContentDescription("Choose model and reasoning").performClick()
            app.onNodeWithText("Medium").assertIsDisplayed()
            app.onNodeWithText("High").assertDoesNotExist()
            app.onNodeWithText("Low").assertDoesNotExist()
        }
    }

    @Test fun modelPickerHasAnExplicitDismissActionThatPreservesTheDraftAndChoices() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            app.onNodeWithTag("composer").performTextInput("Keep this draft")
            app.onNodeWithContentDescription("Choose model and reasoning").performClick()
            app.onNodeWithText("Low").assertIsDisplayed()
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            app.onNodeWithText("Low").assertDoesNotExist()
            app.onNodeWithTag("composer").assertTextContains("Keep this draft")
            assertTrue(engine.commands().none { it.string("type") in listOf("composer", "send") })
        }
    }

    @Test fun modelPickerCanScrollToEveryOfferedEffortWithoutAnExtraSheetExpansion() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            val catalog = state()
            catalog.items("models").first().put("efforts", JSONArray(listOf("low", "medium", "high", "xhigh", "max")))
            engine.state(catalog); mount(engine)
            app.onNodeWithContentDescription("Choose model and reasoning").performClick()
            app.onNodeWithText("Max").performScrollTo().assertIsDisplayed().performClick()
            app.waitUntil(5_000) { engine.commands().any { it.string("type") == "composer" } }
            assertEquals("{\"reasoningEffort\":\"max\"}", change(engine).toString())
        }
    }
}
