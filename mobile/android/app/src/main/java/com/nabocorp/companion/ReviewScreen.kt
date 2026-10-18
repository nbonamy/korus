package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
    val connected = state.string("connection") == "connected"
    val choices = model.reviewChoices
    var priorConnection by remember { mutableStateOf(connected) }
    LaunchedEffect(connected) {
        if (connected && !priorConnection) model.command("loadReview", "backend" to choices.backend.ifBlank { null })
        priorConnection = connected
    }
    BackHandler { if (!starting) model.dismissReview() }
    Scaffold(modifier = Modifier.imePadding(), topBar = {
        TopAppBar(title = { Text(if (starting) "" else "Review Changes") }, navigationIcon = {
            if (!starting) IconButton(onClick = model::dismissReview) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to conversation") }
        })
    }, bottomBar = {
        if (!starting && setup != null && !setup.optBoolean("activeReview") && (setup.optBoolean("uncommitted") || setup.optBoolean("branchChanges"))) {
            Surface(shadowElevation = 2.dp) {
                Button(onClick = { model.startReview(choices) }, enabled = connected && state.optBoolean("canSend") && status == "ready" && choices.input(setup) != null,
                    modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) { Text("Start Review") }
            }
        }
    }) { padding ->
        when {
            starting -> ReviewNotice("Starting your review", "${model.product.string("name")} is preparing the reviewer.", Modifier.padding(padding), progress = true)
            setup?.optBoolean("activeReview") == true -> ReviewNotice("Review already started", "Open the reviewer’s conversation to follow its progress.", Modifier.padding(padding)) {
                setup.string("reviewerAgentId").takeIf { it.isNotBlank() }?.let { id -> Button(onClick = { model.selectAgent(id) }) { Text("Open Review Conversation") } }
            }
            setup != null && !setup.optBoolean("uncommitted") && !setup.optBoolean("branchChanges") -> ReviewNotice("Nothing to review", "This workspace has no changes to review.", Modifier.padding(padding))
            setup != null -> ReviewForm(setup, choices, status == "loading" || !connected, status, { model.reviewChoices = it },
                { backend -> model.reviewChoices = choices.copy(backend = backend); model.command("loadReview", "backend" to backend) },
                { model.command("loadReview", "backend" to choices.backend) }, Modifier.padding(padding))
            status == "failed" || !connected -> ReviewNotice("Couldn’t load review setup", "Check your computer connection and try again.", Modifier.padding(padding)) {
                Button(onClick = { if (connected) model.command("loadReview") else model.command("reconnect") }) { Text(if (connected) "Retry" else "Reconnect") }
            }
            else -> ReviewNotice("Loading review setup…", null, Modifier.padding(padding), progress = true)
        }
    }
}

@Composable private fun ReviewForm(setup: JSONObject, choices: ReviewChoices, busy: Boolean, status: String,
    choose: (ReviewChoices) -> Unit, provider: (String) -> Unit, refresh: () -> Unit, modifier: Modifier) {
    val efforts = setup.items("models").firstOrNull { it.string("id") == choices.model }?.strings("efforts").orEmpty()
    LazyColumn(modifier.fillMaxSize().testTag("review-form"), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { ReviewHeading("Scope") }
        item { ReviewChoice("Uncommitted Changes", if (setup.optBoolean("uncommitted")) "Staged and unstaged changes in this workspace." else "No uncommitted changes.",
            choices.scope == "uncommitted", !busy && setup.optBoolean("uncommitted")) { choose(choices.copy(scope = "uncommitted")) } }
        item { ReviewChoice("Current Branch", if (setup.optBoolean("branchChanges")) "${setup.string("branch", "Current branch")} compared with ${setup.string("baseRef", "base branch")}." else "No branch changes available.",
            choices.scope == "branch", !busy && setup.optBoolean("branchChanges") && setup.string("baseRef").isNotBlank()) { choose(choices.copy(scope = "branch")) } }
        item { ReviewHeading("Reviewer") }
        item { ReviewChoice("Independent Reviewer", "A separate agent reviews your changes with fresh context.", choices.thread == "independent", !busy) { choose(choices.copy(thread = "independent")) } }
        item { ReviewChoice("Current Conversation", if (choices.automatic) "Automatic review requires an independent reviewer." else "Review with the context of this conversation.",
            choices.thread == "current", !busy && setup.optBoolean("currentThread") && !choices.automatic) { choose(choices.copy(thread = "current")) } }
        if (choices.thread == "independent") {
            item { ReviewHeading("Model") }
            item { NativeChoicePicker("Engine", "Reviewer engine", choices.backend, setup.strings("backends").map { it to it.replaceFirstChar(Char::uppercase) }, !busy, provider) }
            item { NativeChoicePicker("Model", "Reviewer model", choices.model,
                listOf("" to if (setup.string("backend") == setup.string("agentBackend")) "Current Model" else "Default Model") + setup.items("models").map { it.string("id") to it.string("name") }, !busy) { id ->
                choose(choices.copy(model = id, effort = choices.effort.takeIf { effort -> setup.items("models").firstOrNull { it.string("id") == id }?.strings("efforts")?.contains(effort) == true }.orEmpty()))
            } }
            if (efforts.isNotEmpty()) item { NativeChoicePicker("Reasoning", "Reviewer reasoning", choices.effort, listOf("" to "Default") + efforts.map { it to it.replaceFirstChar(Char::uppercase) }, !busy) { choose(choices.copy(effort = it)) } }
        }
        item { ReviewHeading("Additional Instructions") }
        item { OutlinedTextField(value = choices.instructions, onValueChange = { choose(choices.copy(instructions = it)) }, enabled = !busy,
            placeholder = { Text("What should the reviewer focus on?") }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth().testTag("review-instructions")) }
        item { ReviewToggle("Automatic Review", choices.automatic, !busy) { choose(choices.copy(automatic = it, thread = if (it) "independent" else choices.thread)) } }
        if (choices.automatic) {
            item { NativeChoicePicker("Fix Findings", "Fix findings priority", choices.priority, listOf("p0" to "Critical (P0)", "p1" to "High and above (P1)", "p2" to "Medium and above (P2)", "p3" to "All priorities (P3)"), !busy) { choose(choices.copy(priority = it)) } }
            item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Maximum Rounds: ${choices.rounds}", Modifier.weight(1f))
                IconButton(onClick = { choose(choices.copy(rounds = choices.rounds - 1)) }, enabled = !busy && choices.rounds > 1) { Icon(Icons.Outlined.Remove, "Decrease maximum rounds") }
                IconButton(onClick = { choose(choices.copy(rounds = choices.rounds + 1)) }, enabled = !busy && choices.rounds < 10) { Icon(Icons.Outlined.Add, "Increase maximum rounds") }
            } }
            item { ReviewToggle("Commit Fixes Automatically", choices.autoCommit, !busy) { choose(choices.copy(autoCommit = it)) } }
        }
        item { Text(if (choices.automatic) "The reviewer fixes selected priorities and reviews again, up to the round limit." else "Review findings before deciding which fixes to make.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
        if (status == "unknown" || status == "failed") item {
            Text(if (status == "unknown") "Couldn’t confirm whether the review started. Refresh its status before trying again." else "Couldn’t load reviewer models. Check your connection and retry.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = refresh, enabled = !busy) { Text("Refresh") }
        }
        if (busy) item { Text("Waiting for your computer…", style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable private fun ReviewHeading(text: String) { Text(text, Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }

@Composable private fun ReviewChoice(title: String, detail: String, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    ListItem(headlineContent = { Text(title) }, supportingContent = { Text(detail) }, leadingContent = { RadioButton(selected, onClick = null, enabled = enabled) },
        modifier = Modifier.selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = choose),
        colors = ListItemDefaults.colors(headlineColor = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)))
}

@Composable private fun ReviewToggle(title: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    ListItem(headlineContent = { Text(title) }, trailingContent = { Switch(checked, onCheckedChange = null, enabled = enabled) },
        modifier = Modifier.toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = change))
}

@Composable private fun ReviewNotice(title: String, detail: String?, modifier: Modifier, progress: Boolean = false, action: @Composable () -> Unit = {}) {
    Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        if (progress) CircularProgressIndicator() else Icon(Icons.Outlined.Checklist, null, Modifier.size(36.dp))
        Text(title, style = MaterialTheme.typography.titleLarge)
        detail?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        action()
    }
}
