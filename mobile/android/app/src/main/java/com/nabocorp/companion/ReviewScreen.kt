package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** A native navigation destination; Back returns to the unchanged conversation draft. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ReviewScreen(model: CompanionModel) {
    val state = model.state
    val review = state.obj("review")
    val setup = review.optJSONObject("setup")
    val status = review.string("status")
    val starting = status == "starting"
    val connected = state.connection.isConnected
    val choices = model.reviewChoices
    var priorConnection by remember { mutableStateOf(connected) }
    LaunchedEffect(connected) {
        if (connected && !priorConnection) model.command("loadReview", "backend" to choices.backend.ifBlank { null })
        priorConnection = connected
    }
    BackHandler { if (!starting) model.dismissReview() }
    val ready = !starting && setup != null && !setup.optBoolean("activeReview") && (setup.optBoolean("uncommitted") || setup.optBoolean("branchChanges"))
    AppSheetFrame(if (starting) "" else "Review Changes", Modifier.imePadding(),
        leading = if (starting) null else ({ AppBarIcon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Back to conversation", onClick = model::dismissReview) }),
        footer = if (ready) ({ AppProminentButton("Start Review", connected && state.optBoolean("canSend") && status == "ready" && choices.input(setup!!) != null) { model.startReview(choices) } }) else null, scroll = false) {
        when {
            starting -> AppProgress("Starting your review", Icons.Outlined.Checklist, "${model.productName} is preparing the reviewer.")
            setup?.optBoolean("activeReview") == true -> AppUnavailable("Review already started", Modifier.weight(1f), Icons.Outlined.Checklist, "Open the reviewer’s conversation to follow its progress.") {
                setup.string("reviewerAgentId").takeIf { it.isNotBlank() }?.let { id -> AppUnavailableAction("Open Review Conversation", { model.selectAgent(id) }) }
            }
            setup != null && !setup.optBoolean("uncommitted") && !setup.optBoolean("branchChanges") -> AppUnavailable("Nothing to review", Modifier.weight(1f), Icons.Outlined.CheckCircle, "This workspace has no changes to review.")
            setup != null -> ReviewForm(setup, choices, status == "loading" || !connected, status, { model.reviewChoices = it },
                { backend -> model.reviewChoices = choices.copy(backend = backend); model.command("loadReview", "backend" to backend) },
                { model.command("loadReview", "backend" to choices.backend) }, Modifier.weight(1f))
            status == "failed" || !connected -> AppUnavailable("Couldn’t load review setup", Modifier.weight(1f), Icons.Outlined.WifiOff, "Check your laptop connection and try again.") {
                AppUnavailableAction(if (connected) "Retry" else "Reconnect", { if (connected) model.command("loadReview") else model.command("reconnect") })
            }
            else -> Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(); Text("Loading review setup…", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable private fun ReviewForm(setup: JSONObject, choices: ReviewChoices, busy: Boolean, status: String,
    choose: (ReviewChoices) -> Unit, provider: (String) -> Unit, refresh: () -> Unit, modifier: Modifier) {
    val efforts = setup.items("models").firstOrNull { it.string("id") == choices.model }?.strings("efforts").orEmpty()
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).testTag("review-form").padding(bottom = 24.dp)) {
        AppSection("Scope") {
            ReviewChoice("Uncommitted Changes", if (setup.optBoolean("uncommitted")) "Staged and unstaged changes in this workspace." else "No uncommitted changes.", Icons.Outlined.Difference,
                choices.scope == "uncommitted", !busy && setup.optBoolean("uncommitted")) { choose(choices.copy(scope = "uncommitted")) }
            AppDivider()
            ReviewChoice("Current Branch", if (setup.optBoolean("branchChanges")) "${setup.string("branch", "Current branch")} compared with ${setup.string("baseRef", "base branch")}." else "No branch changes available.", Icons.Outlined.AccountTree,
                choices.scope == "branch", !busy && setup.optBoolean("branchChanges") && setup.string("baseRef").isNotBlank()) { choose(choices.copy(scope = "branch")) }
        }
        AppSection("Reviewer") {
            ReviewChoice("Independent Reviewer", "A separate agent reviews your changes with fresh context.", Icons.Outlined.AccountCircle, choices.thread == "independent", !busy) { choose(choices.copy(thread = "independent")) }
            AppDivider()
            ReviewChoice("Current Conversation", if (choices.automatic) "Automatic review requires an independent reviewer." else "Review with the context of this conversation.", Icons.Outlined.ChatBubbleOutline,
                choices.thread == "current", !busy && setup.optBoolean("currentThread") && !choices.automatic) { choose(choices.copy(thread = "current")) }
        }
        if (choices.thread == "independent") AppSection("Model") {
            NativeChoicePicker("Engine", "Reviewer engine", choices.backend, setup.strings("backends").map { it to it.replaceFirstChar(Char::uppercase) }, !busy, provider)
            AppDivider()
            NativeChoicePicker("Model", "Reviewer model", choices.model,
                listOf("" to if (setup.string("backend") == setup.string("agentBackend")) "Current Model" else "Default Model") + setup.items("models").map { it.string("id") to it.string("name") }, !busy) { id ->
                choose(choices.copy(model = id, effort = choices.effort.takeIf { effort -> setup.items("models").firstOrNull { it.string("id") == id }?.strings("efforts")?.contains(effort) == true }.orEmpty()))
            }
            if (efforts.isNotEmpty()) { AppDivider(); NativeChoicePicker("Reasoning", "Reviewer reasoning", choices.effort, listOf("" to "Default") + efforts.map { it to it.replaceFirstChar(Char::uppercase) }, !busy) { choose(choices.copy(effort = it)) } }
        }
        AppSection("Additional Instructions") {
            OutlinedTextField(value = choices.instructions, onValueChange = { choose(choices.copy(instructions = it)) }, enabled = !busy,
                placeholder = { Text("What should the reviewer focus on?", fontSize = 17.sp) }, minLines = 3, maxLines = 6, textStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp),
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Color.Transparent, disabledBorderColor = Color.Transparent),
                modifier = Modifier.fillMaxWidth().testTag("review-instructions"))
        }
        AppSection(footer = if (choices.automatic) "The reviewer fixes selected priorities and reviews again, up to the round limit." else "Review findings before deciding which fixes to make.") {
            ReviewToggle("Automatic Review", choices.automatic, !busy) { choose(choices.copy(automatic = it, thread = if (it) "independent" else choices.thread)) }
            if (choices.automatic) {
                AppDivider()
                NativeChoicePicker("Fix Findings", "Fix findings priority", choices.priority, listOf("p0" to "Critical (P0)", "p1" to "High and above (P1)", "p2" to "Medium and above (P2)", "p3" to "All priorities (P3)"), !busy) { choose(choices.copy(priority = it)) }
                AppDivider()
                AppRow("Maximum Rounds: ${choices.rounds}", trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { choose(choices.copy(rounds = choices.rounds - 1)) }, enabled = !busy && choices.rounds > 1) { Icon(Icons.Outlined.Remove, "Decrease maximum rounds") }
                        IconButton(onClick = { choose(choices.copy(rounds = choices.rounds + 1)) }, enabled = !busy && choices.rounds < 10) { Icon(Icons.Outlined.Add, "Increase maximum rounds") }
                    }
                })
                AppDivider()
                ReviewToggle("Commit Fixes Automatically", choices.autoCommit, !busy) { choose(choices.copy(autoCommit = it)) }
            }
        }
        if (status == "unknown" || status == "failed") AppSection {
            Text(if (status == "unknown") "Couldn’t confirm whether the review started. Refresh its status before trying again." else "Couldn’t load reviewer models. Check your connection and retry.", Modifier.padding(16.dp), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            AppDivider()
            AppRow("Refresh", titleColor = MaterialTheme.colorScheme.primary, enabled = !busy, onClick = refresh)
        }
    }
}

@Composable private fun ReviewChoice(title: String, detail: String, icon: ImageVector, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    AppChoiceRow(title, detail, icon, selected, enabled, choose)
}

@Composable private fun ReviewToggle(title: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    AppRow(title, Modifier.toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = change), enabled = enabled, trailing = { Switch(checked, onCheckedChange = null, enabled = enabled) })
}
