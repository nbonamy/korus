package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Difference
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.ui.unit.sp
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
    val connected = model.state.connection.isConnected
    BackHandler { model.dismissChanges() }
    AppSheetFrame("Changes", leading = { AppBarIcon(Icons.Outlined.Close, "Close changes", onClick = model::dismissChanges) },
        trailing = { AppBarIcon(Icons.Outlined.Refresh, "Refresh changes", connected && git.string("status") != "loading") { model.loadChanges() } }, scroll = false) {
        ChangesScopePicker(git,connected) { model.loadChanges(it) }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !connected -> AppUnavailable("Laptop disconnected", Modifier.fillMaxSize(), Icons.Outlined.WifiOff, "Reconnect to your laptop to load changes.") { AppUnavailableAction("Reconnect", { model.command("reconnect") }) }
                git.string("status") == "failed" || model.changesPageFailed -> AppUnavailable("Couldn’t load changes", Modifier.fillMaxSize(), Icons.Outlined.Difference, "Check the connection and try again.") { AppUnavailableAction("Retry", { model.loadChanges() }) }
                git.string("status") == "loaded" -> WebContent(model.changes,Modifier.fillMaxSize().testTag("changes-patch"))
                else -> Column(Modifier.fillMaxSize(),verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(); Text("Loading changes…",fontSize = 15.sp,color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        Surface(shape = RoundedCornerShape(16.dp),color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().clickable(enabled = enabled,role = Role.Button) { open = true; commits = false }
                .semantics { contentDescription = "Change scope" }.padding(16.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(selected?.string("label") ?: "Uncommitted changes",Modifier.weight(1f),maxLines = 1,overflow = TextOverflow.Ellipsis,fontSize = 17.sp)
                if (summary != null) {
                    Text("+${summary.optInt("addedLines")}",color = CompanionColors.addedLines,fontSize = 15.sp)
                    Text("−${summary.optInt("removedLines")}",color = MaterialTheme.colorScheme.error,fontSize = 15.sp)
                }
                Icon(Icons.Outlined.UnfoldMore,null,Modifier.size(18.dp),tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
