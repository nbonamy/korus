package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun CreationScreen(model: CompanionModel) {
    val flow = model.creation ?: return
    val state = model.state
    val busy = flow.submitted || state.string("chatCreation") == "creating"
    val connected = state.string("connection") == "connected"
    val failed = state.string("chatCreation") == "failed"
    var wasConnected by remember { mutableStateOf(connected) }
    LaunchedEffect(connected) {
        if (connected && !wasConnected) model.refreshCreation()
        wasConnected = connected
    }
    BackHandler { if (!busy) model.backCreation() }
    Scaffold(modifier = Modifier.imePadding(), topBar = {
        TopAppBar(title = { Text(if (busy) "" else flow.title) }, navigationIcon = {
            if (!busy && flow.kind == CreationKind.GITHUB && flow.repositoryId != null) {
                IconButton(onClick = model::backCreation) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, if (flow.newBranch) "Back to branches" else "Back to repositories") }
            }
        }, actions = {
            if (!busy) IconButton(onClick = model::dismissCreation) { Icon(Icons.Outlined.Close, "Cancel creation") }
        })
    }, bottomBar = {
        if (!busy && connected && flow.action != null && flow.kind !in listOf(CreationKind.QUICK, CreationKind.DEFAULT)) Surface(shadowElevation = 2.dp) {
            Button(onClick = { model.submitCreation() }, enabled = flow.command(state, model.newBackend) != null,
                modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) { Text(flow.action!!) }
        }
    }) { padding ->
        when {
            busy -> CreationNotice(when {
                flow.kind == CreationKind.WORKTREE -> "Creating your worktree"
                flow.newBranch -> "Creating your branch"
                flow.kind == CreationKind.EXISTING || flow.kind == CreationKind.DEFAULT -> "Opening your branch"
                flow.kind == CreationKind.QUICK -> "Starting your chat"
                else -> "Preparing your project"
            }, "${model.product.string("name")} is getting the workspace ready.", Modifier.padding(padding), true,
                flow.repositoryName.ifBlank { flow.value.trim() }, flow.branchName.ifBlank { flow.selectedBranch.orEmpty() })
            !connected -> CreationNotice("Computer disconnected", "Reconnect to your computer to prepare this workspace.", Modifier.padding(padding)) {
                Button(onClick = { model.command("reconnect") }) { Text("Reconnect") }
            }
            flow.kind == CreationKind.GITHUB && !flow.newBranch || flow.kind == CreationKind.EXISTING -> Column(Modifier.padding(padding).fillMaxSize()) {
                CreationEngine(model)
                CreationCatalog(model, flow, state, failed, Modifier.weight(1f))
            }
            flow.kind in listOf(CreationKind.QUICK, CreationKind.DEFAULT) -> CreationNotice("Couldn’t start the chat", "Check the connection and try again.", Modifier.padding(padding)) {
                Button(onClick = { model.submitCreation() }, enabled = flow.command(state, model.newBackend) != null) { Text("Retry") }
            }
            else -> Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                CreationEngine(model)
                if (flow.kind == CreationKind.WORKTREE || flow.newBranch) {
                    Text(flow.repositoryName, style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(value = flow.branchName,onValueChange = { value -> model.editCreation { it.copy(branchName = if (flow.kind == CreationKind.WORKTREE) value.replace(' ', '-') else value) } },label = { Text("Branch name") },singleLine = true,
                        keyboardOptions = creationKeyboard,modifier = Modifier.fillMaxWidth().testTag("branch-name"))
                    if (flow.newBranch) {
                        NativeChoicePicker("From", "Base branch", flow.baseBranch, flow.catalog(state).items("items").map { it.string("name") to it.string("name") }, true) { base -> model.editCreation { it.copy(baseBranch = base) } }
                        val duplicate = flow.catalog(state).items("items").any { it.string("name") == flow.branchName.trim() }
                        Text(if (duplicate) "That branch already exists. Choose it from the branch list or enter a new name." else "Creates a new branch in its own worktree on your computer.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    } else Text("Created from the default branch of ${flow.repositoryName}.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                } else {
                    OutlinedTextField(value = flow.value,onValueChange = { value -> model.editCreation { it.copy(value = value) } },label = { Text(if (flow.kind == CreationKind.PROJECT) "Project name" else "Repository URL") },singleLine = true,
                        keyboardOptions = creationKeyboard.copy(keyboardType = if (flow.kind == CreationKind.URL) KeyboardType.Uri else KeyboardType.Text),modifier = Modifier.fillMaxWidth().testTag("project-value"))
                    Text(if (flow.kind == CreationKind.PROJECT) "Creates a project in your computer’s source folder." else "Clones the repository to your computer’s source folder. Use an HTTPS or SSH URL.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                if (failed) CreationError()
            }
        }
    }
}

private val creationKeyboard = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false)

@Composable private fun CreationEngine(model: CompanionModel) {
    NativeChoicePicker("Engine", "Creation engine", model.newBackend, model.state.strings("backends").map { it to it.replaceFirstChar(Char::uppercase) }, true, model::chooseCreationBackend)
}

@Composable private fun CreationCatalog(model: CompanionModel, flow: CreationFlow, state: JSONObject, failed: Boolean, modifier: Modifier) {
    val repositories = flow.kind == CreationKind.GITHUB && flow.repositoryId == null
    val catalog = if (repositories) state.obj("projectRepositories") else flow.catalog(state)
    val query = if (repositories) flow.query else flow.branchQuery
    val items = catalog.items("items").filter { it.string("name").contains(query, ignoreCase = true) }
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (flow.repositoryName.isNotBlank()) Text(flow.repositoryName, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(value = query,onValueChange = { value -> model.editCreation { if (repositories) it.copy(query = value) else it.copy(branchQuery = value) } },label = { Text(if (repositories) "Search repositories" else "Search branches") },singleLine = true,
            leadingIcon = { Icon(Icons.Outlined.Search,null) },keyboardOptions = creationKeyboard,modifier = Modifier.fillMaxWidth().testTag(if (repositories) "repository-search" else "branch-search"))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 16.dp)) {
            when (catalog.string("status")) {
                "loaded" -> {
                    if (!repositories && flow.kind == CreationKind.GITHUB) item {
                        ListItem(headlineContent = { Text("New Branch", color = MaterialTheme.colorScheme.primary) }, leadingContent = { Icon(Icons.Outlined.Add, null) },
                            modifier = Modifier.clickable(enabled = catalog.items("items").isNotEmpty(), role = Role.Button, onClick = model::newCreationBranch))
                    }
                    items.forEach { entry -> item(key = entry.string(if (repositories) "id" else "name")) {
                        ListItem(headlineContent = { Text(entry.string("name")) }, leadingContent = { Icon(if (repositories) Icons.Outlined.Folder else Icons.Outlined.AccountTree, null) },
                            supportingContent = { if (!repositories && entry.optBoolean("isDefault")) Text("Default") },
                            trailingContent = { if (entry.optBoolean("isCheckedOut")) Text("Checked out", style = MaterialTheme.typography.labelSmall) },
                            modifier = Modifier.clickable(enabled = model.newBackend.isNotBlank(), role = Role.Button) {
                                if (repositories) model.selectCreationRepository(entry) else model.submitCreation(entry.string("name"))
                            })
                        HorizontalDivider(Modifier.padding(start = 56.dp))
                    } }
                    if (items.isEmpty()) item { Text(when {
                        query.isNotBlank() -> if (repositories) "No matching repositories." else "No matching branches."
                        repositories -> "No repositories available."
                        else -> "No branches available."
                    }, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                "failed" -> item {
                    Text(if (repositories) "Couldn’t load repositories. Check the GitHub connection in ${model.product.string("name")} on your computer." else "Couldn’t load branches. Check repository access and try again.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = model::refreshCreation) { Text("Retry") }
                }
                else -> item { Row(Modifier.fillMaxWidth().padding(24.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    Text(if (repositories) "Loading repositories…" else "Loading branches…")
                } }
            }
        }
        if (failed) {
            CreationError()
            TextButton(onClick = model::refreshCreation) { Text(if (repositories) "Refresh repositories" else "Refresh branches") }
        }
    }
}

@Composable private fun CreationError() {
    Text("Couldn’t prepare this workspace. Check the name, repository access and connection, then try again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}

@Composable private fun CreationNotice(title: String, detail: String, modifier: Modifier, busy: Boolean = false, subject: String = "", branch: String = "", action: @Composable () -> Unit = {}) {
    Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        if (busy) CircularProgressIndicator() else Icon(Icons.Outlined.Folder, null, Modifier.size(36.dp))
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (subject.isNotBlank()) Text(subject, style = MaterialTheme.typography.titleSmall)
        if (branch.isNotBlank()) Text(branch, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        action()
    }
}
