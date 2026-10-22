package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun CreationScreen(model: CompanionModel) {
    val flow = model.creation ?: return
    val state = model.state
    val busy = flow.submitted || state.string("chatCreation") == "creating"
    val connected = state.connection.isConnected
    val failed = state.string("chatCreation") == "failed"
    var wasConnected by remember { mutableStateOf(connected) }
    LaunchedEffect(connected) {
        if (connected && !wasConnected) model.refreshCreation()
        wasConnected = connected
    }
    BackHandler { if (!busy) model.backCreation() }
    val picker = flow.projectCatalog && !flow.newBranch || flow.kind == CreationKind.EXISTING
    val action = flow.action.takeIf { !busy && connected && flow.kind !in listOf(CreationKind.QUICK, CreationKind.DEFAULT, CreationKind.WORKTREE) }
    AppSheetFrame(if (busy || flow.kind == CreationKind.WORKTREE) "" else flow.title, Modifier.imePadding(),
        leading = if (!busy && flow.projectCatalog && flow.repositoryId != null) ({
            AppBarPill(if (flow.newBranch) "Branches" else "Repositories", description = if (flow.newBranch) "Back to branches" else "Back to repositories", onClick = model::backCreation, icon = Icons.AutoMirrored.Outlined.KeyboardArrowLeft)
        }) else null,
        trailing = if (busy) null else ({ AppBarPill("Cancel", description = "Cancel creation", onClick = model::dismissCreation) }),
        footer = action?.let { text -> { AppProminentButton(text, flow.command(state, model.newBackend) != null) { model.submitCreation() } } }, scroll = false) {
        when {
            busy -> AppProgress(when {
                flow.kind == CreationKind.WORKTREE -> "Creating your worktree"
                flow.newBranch -> "Creating your branch"
                flow.kind == CreationKind.EXISTING || flow.kind == CreationKind.DEFAULT -> "Opening your branch"
                flow.kind == CreationKind.QUICK -> "Starting your chat"
                else -> "Preparing your project"
            }, if (flow.kind == CreationKind.PROJECT || flow.kind == CreationKind.URL || flow.projectCatalog && !flow.newBranch) Icons.Outlined.CreateNewFolder else Icons.Outlined.AccountTree,
                "${model.productName} is getting the workspace ready.", subject = flow.repositoryName.ifBlank { flow.value.trim() }, branch = flow.branchName.ifBlank { flow.selectedBranch.orEmpty() })
            !connected -> if (flow.kind == CreationKind.EXISTING) AppUnavailable("Not connected", Modifier.weight(1f), Icons.Outlined.WifiOff, "Reconnect to your laptop to browse branches.")
                else AppUnavailable("Laptop disconnected", Modifier.weight(1f), Icons.Outlined.WifiOff, "Reconnect to your laptop to start a project.") { AppUnavailableAction("Reconnect", { model.command("reconnect") }) }
            picker -> CreationCatalog(model, flow, state, failed, Modifier.weight(1f))
            flow.kind in listOf(CreationKind.QUICK, CreationKind.DEFAULT) -> AppUnavailable("Couldn’t start the chat", Modifier.weight(1f), Icons.Outlined.ErrorOutline, "Check the connection and try again.") {
                AppUnavailableAction("Retry", { model.submitCreation() }, flow.command(state, model.newBackend) != null)
            }
            flow.kind == CreationKind.WORKTREE -> Column(Modifier.weight(1f).fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("New worktree", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface) {
                    AppTextField(flow.branchName, { value -> model.editCreation { it.copy(branchName = value.replace(' ', '-')) } }, "Branch name", Modifier.testTag("branch-name"), keyboardOptions = creationKeyboard,
                        leading = { Icon(Icons.Outlined.AccountTree, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) })
                }
                if (failed) Text("Couldn’t create the worktree. Check the branch name and the connection.", fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                else Text("Created from the default branch of ${flow.repositoryName}.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppProminentButton("Create", flow.command(state, model.newBackend) != null) { model.submitCreation() }
            }
            else -> Column(Modifier.weight(1f).fillMaxWidth().verticalScrollIfNeeded()) {
                if (flow.newBranch) {
                    AppSection(flow.repositoryName, if (flow.catalog(state).items("items").any { it.string("name") == flow.branchName.trim() }) "That branch already exists. Choose it from the branch list or enter a new name." else "Creates a new branch in its own worktree on your laptop.") {
                        AppTextField(flow.branchName, { value -> model.editCreation { it.copy(branchName = value) } }, "Branch name", Modifier.testTag("branch-name"), keyboardOptions = creationKeyboard)
                        AppDivider()
                        NativeChoicePicker("From", "Base branch", flow.baseBranch, flow.catalog(state).items("items").map { it.string("name") to it.string("name") }, true) { base -> model.editCreation { it.copy(baseBranch = base) } }
                    }
                } else AppSection(footer = if (flow.kind == CreationKind.PROJECT) "Creates a Git repository in your laptop’s source folder." else "Clones the repository to your laptop’s source folder. Use an HTTPS or SSH URL.") {
                    AppTextField(flow.value, { value -> model.editCreation { it.copy(value = value) } }, if (flow.kind == CreationKind.PROJECT) "Project name" else "Repository URL",
                        Modifier.testTag("project-value"), keyboardOptions = creationKeyboard.copy(keyboardType = if (flow.kind == CreationKind.URL) KeyboardType.Uri else KeyboardType.Text))
                }
                if (failed) CreationError(flow.newBranch)
            }
        }
    }
}

private fun Modifier.verticalScrollIfNeeded(): Modifier = this

private val creationKeyboard = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false)

@Composable private fun CreationCatalog(model: CompanionModel, flow: CreationFlow, state: JSONObject, failed: Boolean, modifier: Modifier) {
    val repositories = flow.projectCatalog && flow.repositoryId == null
    val catalog = if (repositories) state.obj("projectRepositories") else flow.catalog(state)
    val query = if (repositories) flow.query else flow.branchQuery
    val items = catalog.items("items").filter { it.string("name").contains(query, ignoreCase = true) }
    val existing = flow.kind == CreationKind.EXISTING
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (flow.repositoryName.isNotBlank()) Text(flow.repositoryName, Modifier.padding(horizontal = 4.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(Modifier.fillMaxWidth().weight(1f, fill = false), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
            Column {
                AppTextField(query, { value -> model.editCreation { if (repositories) it.copy(query = value) else it.copy(branchQuery = value) } }, if (repositories) "Search repositories" else "Search branches",
                    Modifier.testTag(if (repositories) "repository-search" else "branch-search"), keyboardOptions = creationKeyboard,
                    leading = { Icon(Icons.Outlined.Search, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                LazyColumn(Modifier.fillMaxWidth()) {
                    when (catalog.string("status")) {
                        "loaded" -> {
                            if (!repositories && flow.projectCatalog) item {
                                AppRow("New Branch", icon = Icons.Outlined.Add, titleColor = MaterialTheme.colorScheme.primary, enabled = catalog.items("items").isNotEmpty(), onClick = model::newCreationBranch)
                                AppDivider()
                            }
                            items.forEach { entry -> item(key = entry.string(if (repositories) "id" else "name")) {
                                val subtitle = when { !repositories && entry.optBoolean("isDefault") -> "Default"; else -> "" }
                                Row(Modifier.fillMaxWidth().clickable(enabled = model.newBackend.isNotBlank(), role = Role.Button) {
                                    if (repositories) model.selectCreationRepository(entry) else model.submitCreation(entry.string("name"))
                                }.heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Icon(if (repositories) Icons.Outlined.Folder else Icons.Outlined.AccountTree, null, Modifier.size(22.dp), tint = if (repositories) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(entry.string("name"), fontSize = 17.sp)
                                        if (existing && subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    if (!existing && subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    if (entry.optBoolean("isCheckedOut")) Text("Checked out", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                AppDivider()
                            } }
                            if (items.isEmpty()) item { Text(when {
                                query.isNotBlank() -> if (repositories) "No matching repositories." else "No matching branches."
                                repositories -> "No repositories available."
                                else -> "No branches available."
                            }, Modifier.padding(16.dp), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        "failed" -> item {
                            Text(if (repositories) if (flow.kind == CreationKind.LOCAL) "Couldn’t load repositories. Check the source folder in ${model.productName} on your computer." else "Couldn’t load repositories. Check the GitHub connection in ${model.productName} on your computer." else "Couldn’t load branches. Check repository access and try again.", Modifier.padding(16.dp), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick = model::refreshCreation, Modifier.padding(horizontal = 8.dp)) { Text("Retry", fontSize = 17.sp) }
                        }
                        else -> item { Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text(if (repositories) "Loading repositories…" else "Loading branches…", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        } }
                    }
                }
            }
        }
        if (failed) {
            CreationError(false)
            TextButton(onClick = model::refreshCreation) { Text(if (repositories) "Refresh repositories" else "Refresh branches", fontSize = 15.sp) }
        }
    }
}

@Composable private fun CreationError(branch: Boolean) {
    Text(if (branch) "Couldn’t create this branch. Check the branch name and repository access, then try again." else "Couldn’t open the project. Check repository access and try again.",
        Modifier.padding(horizontal = 32.dp, vertical = 12.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
