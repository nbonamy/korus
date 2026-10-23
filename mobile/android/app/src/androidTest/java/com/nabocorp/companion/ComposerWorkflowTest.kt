package com.nabocorp.companion

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import org.junit.After
import org.junit.runner.RunWith

/** Protects native draft isolation, asynchronous picker ownership and engine delivery receipts. */
@RunWith(AndroidJUnit4::class)
class ComposerWorkflowTest {
    @get:Rule val app = createAndroidComposeRule<CompanionActivity>()
    private val preferences get() = ApplicationProvider.getApplicationContext<CompanionApplication>().getSharedPreferences("preferences", 0)
    private var previousMode: String? = null
    @Before fun resetPreference() { previousMode = preferences.getString("composer.followUpBehavior", null); preferences.edit().remove("composer.followUpBehavior").commit() }
    @After fun restorePreference() { preferences.edit().putString("composer.followUpBehavior", previousMode).commit() }
    private fun target(host: String = "host-a", session: String? = "session-a") = ConversationTarget(host, "local", "team", "agent", session)
    private fun state(target: ConversationTarget, working: Boolean = false) = json("startup" to "ready", "connection" to "connected", "agentId" to target.agentId,
        "composerTarget" to target.toJson(), "canSend" to true, "capabilities" to json("attachments" to true, "goals" to true, "interrupt" to true),
        "header" to json("status" to if (working) "working" else "idle"))

    @Test fun latePickerAndUnknownDeliveryStayWithTheOriginalConversation() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(target()))
            var pickerOpened = false
            app.activityRule.scenario.onActivity { activity ->
                activity.setContent { MaterialTheme { Composer(engine.model, { engine.model.beginAttachmentImport(); pickerOpened = true }, {}) } }
            }
            app.onNodeWithTag("composer").performTextInput("Inspect this file")
            app.onNodeWithContentDescription("Add").performClick()
            app.onNodeWithText("Add Files").performClick()
            app.runOnIdle { assertTrue(pickerOpened) }
            app.onNodeWithText("Preparing attachments…").assertIsDisplayed()
            engine.state(state(target("host-b", "session-b")))
            app.onNodeWithTag("composer").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
            app.onNodeWithTag("composer").performTextInput("Other computer")
            val context = ApplicationProvider.getApplicationContext<CompanionApplication>()
            val file = java.io.File(context.cacheDir, "camera/native-composer-note.txt").apply { parentFile!!.mkdirs(); writeText("Native attachment verification") }
            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.attachments", file)
            try {
                lateinit var importing: kotlinx.coroutines.Job
                app.runOnIdle { importing = engine.model.pickedAttachments(listOf(uri), false)!! }
                app.waitUntil(10_000) { importing.isCompleted }
                app.onNodeWithText(file.name).assertDoesNotExist()
                engine.state(state(target()))
                app.onNodeWithTag("composer").assertTextEquals("Inspect this file")
                app.onNodeWithText(file.name).assertIsDisplayed()
                app.onNodeWithContentDescription("Send").performClick()
                app.onNodeWithContentDescription("Sending").assertIsNotEnabled()
                val command = engine.commands().single { it.string("type") == "send" }
                assertEquals(target(), ConversationTarget.parse(command.obj("target")))
                assertEquals("steer", command.string("followUpBehavior"))
                val upload = command.items("uploads").single()
                assertEquals("file", upload.string("type")); assertEquals("text/plain", upload.string("mimeType"))
                assertEquals("Native attachment verification", String(android.util.Base64.decode(upload.string("data"), android.util.Base64.DEFAULT)))
                engine.event("sendResult", json("requestId" to command.string("requestId"), "status" to "unknown"))
                app.waitUntil(5000) { !engine.model.composerDrafts.sending }
                app.onNodeWithText("Delivery couldn’t be confirmed.", substring = true).assertIsDisplayed()
                app.onNodeWithTag("composer").performTextReplacement("A newer draft")
                engine.event("sendResult", json("requestId" to command.string("requestId"), "status" to "accepted"))
                app.waitUntil(5000) { engine.model.composerDrafts.items.isEmpty() }
                app.onNodeWithTag("composer").assertTextEquals("A newer draft")
                engine.state(state(target("host-b", "session-b")))
                app.onNodeWithTag("composer").assertTextEquals("Other computer")
            } finally { file.delete() }
        }
    }

    @Test fun firstSessionAcceptanceFollowsItsDraftAndOneMessageOverrideKeepsThePreference() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(target(session = null), working = true))
            app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { Composer(engine.model, {}, {}) } } }
            app.onNodeWithTag("composer").performTextInput("After this turn")
            app.onNodeWithContentDescription("Steer agent").performTouchInput { longClick() }
            app.onNodeWithText("Queue").performClick()
            val command = engine.commands().single { it.string("type") == "send" }
            assertEquals("queue", command.string("followUpBehavior"))
            assertTrue(command.obj("target").has("sessionId")); assertTrue(command.obj("target").isNull("sessionId"))
            assertFalse(command.optBoolean("goalMode"))
            engine.state(state(target(session = "initialized-session"), working = true))
            engine.event("sendResult", json("requestId" to command.string("requestId"), "status" to "accepted"))
            app.waitUntil(5000) { !engine.model.composerDrafts.sending }
            app.onNodeWithTag("composer").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
            app.onNodeWithContentDescription("Stop").assertIsEnabled()
            app.onNodeWithTag("composer").performTextInput("Steer next")
            app.onNodeWithContentDescription("Steer agent").performClick()
            assertEquals("steer", engine.commands().last { it.string("type") == "send" }.string("followUpBehavior"))
        }
    }

    @Test fun attachmentLimitsAndGoalModePreserveTheExistingDraft() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(target()))
            app.runOnIdle {
                val drafts = engine.model.composerDrafts
                drafts.text = "Keep this"
                val first = drafts.beginImport()!!
                drafts.finishImport(first, listOf(ComposerAttachment("big.bin", "application/octet-stream", "file", ByteArray(2_000_000))))
                drafts.finishImport(drafts.beginImport()!!, listOf(ComposerAttachment("extra.bin", "application/octet-stream", "file", ByteArray(600_000))))
                assertEquals(listOf("big.bin"), drafts.items.map { it.name }); assertNotNull(drafts.error)
                drafts.finishImport(drafts.beginImport()!!, (1..5).map { ComposerAttachment("$it.txt", "text/plain", "file", byteArrayOf(1)) })
                assertEquals(1, drafts.items.size)
                drafts.setGoalMode(true); assertFalse(drafts.goalMode)
                drafts.remove(drafts.items.single().id)
                drafts.setGoalMode(true); assertNull(drafts.beginImport())
                val goal = drafts.beginSend("steer")!!
                assertTrue(goal.optBoolean("goalMode")); assertEquals("Keep this", goal.string("text"))
                drafts.completeSend(goal.string("requestId"), "rejected")
                assertTrue(drafts.goalMode); assertEquals("Keep this", drafts.text)
                val retry = drafts.beginSend("steer")!!
                drafts.completeSend(retry.string("requestId"), "accepted")
                assertFalse(drafts.goalMode); assertTrue(drafts.empty)
            }
        }
    }

    @Test fun maximumSizeAttachmentOnlyMessageCrossesTheRealNativeBridge() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(target()))
            val context = ApplicationProvider.getApplicationContext<CompanionApplication>()
            val file = java.io.File(context.cacheDir, "camera/maximum.bin").apply { parentFile!!.mkdirs(); writeBytes(ByteArray(2_500_000) { 57 }) }
            try {
                val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.attachments", file)
                app.activityRule.scenario.onActivity { activity -> activity.setContent { MaterialTheme { Composer(engine.model, {
                    engine.model.beginAttachmentImport(); engine.model.pickedAttachments(listOf(uri), false)
                }, {}) } } }
                app.onNodeWithContentDescription("Add").performClick()
                app.onNodeWithText("Add Files").performClick()
                app.waitUntil(10_000) { engine.model.composerDrafts.items.size == 1 }
                app.onNodeWithContentDescription("Send").performClick()
                val sent = engine.commands().single { it.string("type") == "send" }
                assertEquals("", sent.string("text"))
                val bytes = android.util.Base64.decode(sent.items("uploads").single().string("data"), android.util.Base64.DEFAULT)
                assertEquals(2_500_000, bytes.size); assertTrue(bytes.all { it == 57.toByte() })
            } finally { file.delete() }
        }
    }

    @Test fun cancelledCameraCaptureReleasesOnlyItsOriginalDraftAndDeletesTheTemporaryPhoto() {
        NativeEngineFixture(app.activityRule.scenario).use { engine ->
            app.waitUntil(20_000) { engine.model.state.string("startup") == "ready" }
            engine.state(state(target()))
            lateinit var uri: android.net.Uri
            app.runOnIdle { engine.model.editDraft("Keep my camera draft"); engine.model.beginAttachmentImport(); uri = engine.model.cameraDestination() }
            val resolver = ApplicationProvider.getApplicationContext<CompanionApplication>().contentResolver
            fun readable() = runCatching { resolver.openFileDescriptor(uri, "r")?.use { true } ?: false }.getOrDefault(false)
            assertTrue(readable())
            engine.state(state(target("host-b", "session-b")))
            app.runOnIdle { engine.model.editDraft("Other computer"); engine.model.cameraResult(false) }
            app.waitUntil(5000) { !readable() }
            app.runOnIdle { assertEquals("Other computer", engine.model.draft) }
            engine.state(state(target()))
            app.runOnIdle { assertEquals("Keep my camera draft", engine.model.draft); assertFalse(engine.model.composerDrafts.importing); assertTrue(engine.model.composerDrafts.items.isEmpty()) }
        }
    }
}
