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

/** Native request failures: answers lose question identity, a retry silently replays, consent
 * expands beyond allowed scopes, or a stale form responds to another host/session.
 * Exercises native navigation and the bundled engine port; only engine outcomes are scripted. */
class RequestWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private fun target(host: String = "host", session: String? = "session") = ConversationTarget(host,"remote","team","agent",session)
    private fun question(id: String, multi: Boolean = false, secret: Boolean = false) = json("id" to id,"header" to id,"question" to "Choose $id","isSecret" to secret,"multiSelect" to multi,
        "options" to if (secret) null else JSONArray().put(json("label" to "One","description" to "First choice")).put(json("label" to "Two","description" to "Second choice")))
    private fun pending(kind: String = "question", host: String = "host", session: String? = "session", details: JSONObject? = null): JSONObject {
        val request = json("id" to "same-id","conversationId" to "conversation","kind" to kind)
        when (kind) {
            "question" -> request.put("question",details ?: json("blocking" to true,"questions" to JSONArray().put(question("single")).put(question("multi",true)).put(question("secret",secret = true))))
            "approval" -> request.put("approval",details ?: json("title" to "Run command?","command" to "pwd","cwd" to "/work/project","allowedScopes" to JSONArray(listOf("once")),"canDeny" to true))
            else -> request.put("confirmation",details ?: json("summary" to "Create issue?","integrationName" to "GitHub","toolName" to "create_issue","argumentsPreview" to "{\"title\":\"Review\"}","allowConversation" to true,"allowAlways" to false))
        }
        return json("key" to "$host:$session:same-id","target" to target(host,session).toJson(),"request" to request)
    }
    private fun state(requests: List<JSONObject> = listOf(pending()), host: String = "host", connected: Boolean = true, responding: String? = null, failed: String? = null) = json(
        "startup" to "ready","connection" to if (connected) "connected" else "reconnecting","laptopId" to host,"teamId" to "team","agentId" to "agent","composerTarget" to target(host).toJson(),"canSend" to connected,
        "laptops" to JSONArray().put(json("id" to host,"name" to "Computer")),"header" to json("title" to "Agent"),"capabilities" to json(),
        "requests" to JSONArray(requests),"respondingRequest" to responding,"failedRequest" to failed)
    private fun mount(engine: NativeEngineFixture) {
        app.activityRule.scenario.onActivity { a -> a.setContent { MaterialTheme { CompanionApp(engine.model,{},{},{},{},{},{}) } } }
    }
    private fun open(label: String = "Your input is needed") {
        app.onNodeWithContentDescription("Review request: $label").performClick()
    }
    private fun reveal(tag: String) = app.onNodeWithTag("request-form").performScrollToNode(hasTestTag(tag)).let { app.onNodeWithTag(tag) }
    private fun answer(id: String, value: String) { reveal("request-answer-$id").performTextInput(value) }
    private fun option(id: String, label: String) { reveal("request-option-$id-$label").performClick() }
    private fun action(label: String) { if (label !in listOf("Save","Next","Back","Close","Skip")) app.onNodeWithTag("request-form").performScrollToNode(hasText(label)); app.onNodeWithText(label).performClick(); app.waitForIdle() }
    private fun replies(engine: NativeEngineFixture) = engine.commands().filter { it.string("type") == "respondRequest" }
    private fun tree(v: Any?): Any? = when(v) { JSONObject.NULL -> null; is JSONObject -> v.keys().asSequence().associateWith { tree(v.get(it)) }; is JSONArray -> (0 until v.length()).map { tree(v.get(it)) }; else -> v }

    @Test fun answersRetainIdentityAcrossRecreationAndFailureAndOnlyRetryExplicitly() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state()); mount(e)
            app.onNodeWithTag("composer").performTextInput("Unsent conversation draft")
            app.onNodeWithTag("composer").assertTextContains("Unsent conversation draft")
            open()
            app.onNodeWithText("Next").assertIsDisplayed()
            app.onNodeWithText("Save").assertDoesNotExist()
            app.onNodeWithText("Send Answer").assertDoesNotExist()
            app.onNodeWithText("Skip Question").assertDoesNotExist()
            assertTrue(replies(e).isEmpty())
            option("single","One")
            app.onNodeWithTag("request-answer-single").assertExists()
            option("single","Two"); answer("single"," Custom "); action("Next")
            option("multi","Two"); option("multi","One"); answer("multi"," Third ")
            action("Next"); answer("secret","private-answer")
            reveal("request-answer-secret").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Password))
            app.activityRule.scenario.recreate(); mount(e)
            reveal("request-answer-secret").assertTextContains("private-answer")
            action("Back"); action("Back")
            reveal("request-answer-single").assertTextContains(" Custom ")
            action("Next"); action("Next")
            action("Save")
            val expected = json("type" to "respondRequest","reply" to json("target" to target().toJson(),"id" to "same-id","conversationId" to "conversation","outcome" to json("kind" to "answered","answers" to json(
                "single" to json("answers" to JSONArray(listOf("Custom"))),"multi" to json("answers" to JSONArray(listOf("One","Two","Third"))),"secret" to json("answers" to JSONArray(listOf("private-answer")))))))
            assertEquals(tree(expected),tree(replies(e).single()))
            app.onNodeWithText("Sending your response").assertIsDisplayed()
            app.onNodeWithContentDescription("Close request").assertDoesNotExist()
            e.state(state(responding = "host:session:same-id"))
            app.activityRule.scenario.recreate(); mount(e)
            app.onNodeWithText("Sending your response").assertIsDisplayed()
            e.state(state(failed = "host:session:same-id"))
            app.onNodeWithTag("request-form").performScrollToNode(hasText("The response wasn’t confirmed.",substring = true))
            app.onNodeWithText("The response wasn’t confirmed.",substring = true).assertIsDisplayed()
            assertEquals(1,replies(e).size)
            action("Save"); assertEquals(2,replies(e).size)
            e.state(state(emptyList()))
            app.onNodeWithTag("composer").assertTextContains("Unsent conversation draft")
            app.onNodeWithContentDescription("Review request: Your input is needed").assertDoesNotExist()
        }
    }

    @Test fun approvalUsesOnlyOfferedScopesShowsPermissionsAndDisablesResponseOffline() {
        val approval=json("title" to "Run deployment?","description" to "Review the requested access.","command" to "./deploy --dry-run","cwd" to "/work/project",
            "allowedScopes" to JSONArray(listOf("session")),"canDeny" to false,"requestedPermissions" to JSONArray().put(json("kind" to "filesystem","access" to "write","path" to "/work/output")).put(json("kind" to "network","protocol" to "https","host" to "example.com","enabled" to true)))
        val request=pending("approval",session = null,details = approval)
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state(listOf(request))); mount(e); open("Approval needed")
            app.onNodeWithText("./deploy --dry-run").assertIsDisplayed()
            app.onNodeWithText("/work/output").assertIsDisplayed()
            app.onNodeWithText("https: example.com").assertIsDisplayed()
            app.onNodeWithText("Allow Once").assertDoesNotExist(); app.onNodeWithText("Deny").assertDoesNotExist()
            e.state(state(listOf(request),connected = false))
            app.onNodeWithTag("request-form").performScrollToNode(hasText("Allow for Session"))
            app.onNodeWithText("Allow for Session").assertIsNotEnabled()
            app.onNodeWithText("Done").performClick()
            assertTrue(replies(e).isEmpty())
            e.state(state(listOf(request))); open("Approval needed"); action("Allow for Session")
            assertEquals(tree(json("type" to "respondRequest","reply" to json("target" to target(session=null).toJson(),"id" to "same-id","conversationId" to "conversation","outcome" to json("kind" to "decision","decision" to "allow_conversation")))),tree(replies(e).single()))
        }
    }

    @Test fun toolConfirmationHonorsConversationAndAlwaysConsentAndNeverFollowsAnotherHost() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state(listOf(pending("toolConfirmation")))); mount(e); open("Approval needed")
            app.onNodeWithText("GitHub").assertIsDisplayed(); app.onNodeWithText("create_issue").assertIsDisplayed()
            app.onNodeWithText("Always Allow").assertDoesNotExist()
            app.onNodeWithText("Allow for Conversation").assertExists()
            e.state(state(listOf(pending("toolConfirmation",host="another")),host="another"))
            app.onNodeWithTag("request-form").assertDoesNotExist()
            assertTrue(replies(e).isEmpty())
            open("Approval needed"); action("Deny")
            assertEquals(tree(json("type" to "respondRequest","reply" to json("target" to target("another").toJson(),"id" to "same-id","conversationId" to "conversation","outcome" to json("kind" to "decision","decision" to "deny")))),tree(replies(e).single()))
        }
    }

    @Test fun aQuestionCanBeHiddenFromChatOrSkippedFromItsFormWithoutHidingApprovals() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            val request = pending()
            e.state(state(listOf(request))); mount(e)
            app.onNodeWithContentDescription("Dismiss question").assertIsDisplayed().performClick()
            app.waitUntil(5_000) { e.commands().any { it.string("type") == "dismissRequest" } }
            assertEquals(request.string("key"), e.commands().last { it.string("type") == "dismissRequest" }.string("key"))
            assertTrue(replies(e).isEmpty())
            app.onNodeWithTag("request-form").assertDoesNotExist()
            e.state(state(emptyList()))
            app.onNodeWithContentDescription("Review request: Your input is needed").assertDoesNotExist()
            e.state(state(listOf(request))); open()
            action("Next"); action("Next")
            app.onNodeWithText("Skip").performClick()
            assertEquals(tree(json("kind" to "cancelled")), tree(replies(e).single().obj("reply").obj("outcome")))
            e.state(state(emptyList())); e.state(state(listOf(pending("approval"))))
            app.onNodeWithContentDescription("Dismiss question").assertDoesNotExist()
            app.onNodeWithContentDescription("Review request: Approval needed").assertIsDisplayed()
            assertEquals(1,replies(e).size)
        }
    }

    @Test fun pagesRetainAnswersAndRequireExplicitNextAfterChoosingAnAnswer() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            e.state(state()); mount(e); open()
            app.onNodeWithTag("request-answer-multi").assertDoesNotExist()
            answer("single","Typed answer"); action("Next")
            app.onNodeWithTag("request-answer-single").assertDoesNotExist()
            action("Back")
            reveal("request-answer-single").assertTextContains("Typed answer")
            option("single","One")
            app.onNodeWithTag("request-option-single-One").assertIsSelected()
            app.onNodeWithTag("request-answer-single").assertExists()
            app.onNodeWithTag("request-answer-multi").assertDoesNotExist()
            action("Next")
            app.onNodeWithTag("request-answer-multi").assertExists()
            action("Next")
            app.onNodeWithText("Save").assertIsEnabled()
            assertTrue(replies(e).isEmpty())
            action("Save")
            assertEquals(tree(json("kind" to "answered","answers" to json("single" to json("answers" to JSONArray(listOf("One"))),"multi" to json("answers" to JSONArray()),"secret" to json("answers" to JSONArray())))),tree(replies(e).single().obj("reply").obj("outcome")))
        }
    }

    @Test fun closingLeavesTheQuestionPendingAndAuthoritativeRemovalNeverReplaysOldAnswers() {
        NativeEngineFixture(app.activityRule.scenario).use { e ->
            app.waitUntil(20_000) { e.model.state.string("startup") == "ready" }
            val request=pending(details=json("blocking" to true,"questions" to JSONArray().put(question("single"))))
            e.state(state(listOf(request))); mount(e); open()
            app.onNodeWithText("Close").assertIsDisplayed().performClick()
            app.onNodeWithContentDescription("Review request: Your input is needed").assertIsDisplayed()
            assertTrue(e.commands().none { it.string("type") in listOf("respondRequest","dismissRequest") })
            open(); answer("single","Custom")
            app.onNodeWithText("Save").assertIsDisplayed().assertIsEnabled()
            reveal("request-answer-single").performTextClearance()
            app.onNodeWithText("Skip").assertIsDisplayed()
            option("single","One")
            app.onNodeWithText("Save").assertIsEnabled()
            e.state(state(listOf(request),connected=false))
            app.onNodeWithText("Save").assertIsNotEnabled()
            app.onNodeWithText("Close").performClick()
            assertTrue(replies(e).isEmpty())
            e.state(state(emptyList())); e.state(state(listOf(request)))
            open()
            app.onNodeWithText("Skip").assertIsDisplayed()
            app.onNodeWithText("Save").assertDoesNotExist()
            e.state(state(listOf(request),connected=false))
            app.onNodeWithText("Skip").assertIsNotEnabled()
            app.onNodeWithText("Close").assertIsDisplayed()
            assertTrue(replies(e).isEmpty())
        }
    }
}
