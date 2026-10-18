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

/** Model/reasoning and Fast choices must use offered catalog identifiers and explicit null for
 * Standard service, without leaking an unavailable or disconnected choice into the engine. */
class ModelControlsWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun state(model: String = "first", effort: String = "high", tier: String? = null, connected: Boolean = true) = json(
        "startup" to "ready", "connection" to if (connected) "connected" else "reconnecting", "agentId" to "agent", "canSend" to connected,
        "composerTarget" to ConversationTarget("host","local","team","agent","session").toJson(), "laptops" to JSONArray().put(json("id" to "host")),
        "capabilities" to json("serviceTier" to true, "reasoningEffort" to true),
        "composer" to json("modelId" to model, "effort" to effort, "serviceTier" to tier),
        "models" to JSONArray().put(json("id" to "first", "name" to "First model", "efforts" to JSONArray(listOf("high","low")),
            "tiers" to JSONArray().put(json("id" to "priority", "name" to "Fast"))))
            .put(json("id" to "second", "name" to "Second model", "efforts" to JSONArray(listOf("medium")), "tiers" to JSONArray().put(json("id" to "ultrafast", "name" to "Fast")))))
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { CompanionApp(engine.model, {}, {}, {}, {}, {}, {}) } } }
        app.onNodeWithTag("composer").performClick()
    }
    private fun change(engine: NativeEngineFixture): JSONObject = engine.commands().last { it.string("type") == "composer" }.obj("change")

    @Test fun fastToggleUsesActualPriorityTierAndClearsItWithExplicitNull() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state()); mount(engine)
            app.onNodeWithContentDescription("Fast mode").assertIsOff().performClick()
            assertEquals("{\"serviceTier\":\"priority\"}", change(engine).toString())
            engine.state(state(tier = "priority"))
            app.onNodeWithContentDescription("Fast mode").assertIsOn().performClick()
            assertTrue(change(engine).has("serviceTier")); assertTrue(change(engine).isNull("serviceTier"))
            engine.state(state(connected = false))
            app.onNodeWithContentDescription("Fast mode").assertIsNotEnabled()
            app.onNodeWithContentDescription("Choose model and reasoning").assertIsNotEnabled()
            engine.state(state().put("capabilities", json("serviceTier" to false, "reasoningEffort" to true)))
            app.onNodeWithContentDescription("Fast mode").assertDoesNotExist()
            engine.state(state(model = "second", effort = "medium"))
            app.onNodeWithContentDescription("Fast mode").assertDoesNotExist()
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
            app.onNodeWithText("Done").assertIsDisplayed().performClick()
            app.onNodeWithText("Choose a model").assertDoesNotExist()
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
