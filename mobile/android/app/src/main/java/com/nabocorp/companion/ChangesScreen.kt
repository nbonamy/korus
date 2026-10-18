package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** Native scope/navigation chrome; patch parsing and rendering remain in the shared diff page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ChangesScreen(model: CompanionModel) {
    val git = model.state.obj("git")
    val connected = model.state.string("connection") == "connected"
    BackHandler { model.dismissChanges() }
    Scaffold(topBar = {
        CenterAlignedTopAppBar(title = { Text("Changes") },navigationIcon = {
            IconButton(onClick = model::dismissChanges) { Icon(Icons.Outlined.Close,"Close changes") }
        },actions = {
            IconButton(onClick = { model.loadChanges() },enabled = connected && git.string("status") != "loading") { Icon(Icons.Outlined.Refresh,"Refresh changes") }
        })
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ChangesScopePicker(git,connected) { model.loadChanges(it) }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    !connected -> ChangesNotice("Computer disconnected","Reconnect to your computer to load changes.") {
                        TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect") }
                    }
                    git.string("status") == "failed" || model.changesPageFailed -> ChangesNotice("Couldn’t load changes","Check the connection and try again.") {
                        TextButton(onClick = { model.loadChanges() }) { Text("Retry") }
                    }
                    git.string("status") == "loaded" -> WebContent(model.changes,Modifier.fillMaxSize().testTag("changes-patch"))
                    else -> Column(Modifier.fillMaxSize(),verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(); Text("Loading changes…",color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable private fun ChangesScopePicker(git: JSONObject, enabled: Boolean, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var commits by remember { mutableStateOf(false) }
    LaunchedEffect(enabled) { if (!enabled) { open = false; commits = false } }
    val choices = git.items("choices")
    val selected = choices.firstOrNull { it.string("id") == git.string("scopeId") }
    val summary = git.optJSONObject("summary")
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp,vertical = 12.dp)) {
        Surface(shape = RoundedCornerShape(16.dp),color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Row(Modifier.fillMaxWidth().clickable(enabled = enabled,role = Role.Button) { open = true; commits = false }
                .semantics { contentDescription = "Change scope" }.padding(16.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(selected?.string("label") ?: "Uncommitted changes",Modifier.weight(1f),maxLines = 1,overflow = TextOverflow.Ellipsis)
                if (summary != null) {
                    Text("+${summary.optInt("addedLines")}",color = CompanionColors.addedLines,style = MaterialTheme.typography.labelLarge)
                    Text("−${summary.optInt("removedLines")}",color = MaterialTheme.colorScheme.error,style = MaterialTheme.typography.labelLarge)
                }
                Icon(Icons.Outlined.ExpandMore,null,Modifier.size(18.dp))
            }
        }
        DropdownMenu(expanded = open && enabled,onDismissRequest = { open = false }) {
            if (commits) {
                DropdownMenuItem(text = { Text("Change scopes") },leadingIcon = { Icon(Icons.AutoMirrored.Outlined.ArrowBack,null) },onClick = { commits = false })
                HorizontalDivider()
            }
            choices.filter { it.string("id").startsWith("commit:") == commits }.forEach { choice ->
                DropdownMenuItem(text = {
                    Column {
                        Text(choice.string("label"),maxLines = 2,overflow = TextOverflow.Ellipsis)
                        choice.string("detail").takeIf(String::isNotBlank)?.let { Text(it,style = MaterialTheme.typography.bodySmall,color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                },trailingIcon = { if (choice.string("id") == git.string("scopeId")) Icon(Icons.Outlined.Check,null) },
                    onClick = { open = false; choose(choice.string("id")) })
            }
            if (!commits && choices.any { it.string("id").startsWith("commit:") }) {
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Commits") },leadingIcon = { Icon(Icons.Outlined.History,null) },onClick = { commits = true })
            }
        }
    }
}

@Composable private fun ChangesNotice(title: String, description: String, action: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp),verticalArrangement = Arrangement.spacedBy(12.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title,style = MaterialTheme.typography.titleLarge)
        Text(description,color = MaterialTheme.colorScheme.onSurfaceVariant)
        action()
    }
}
