package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** Consent is local to the complete preview target; the shared engine validates the mutation. */
@Composable internal fun CloseSessionContent(preview: JSONObject, busy: Boolean, failed: Boolean, confirm: (JSONObject) -> Unit, cancel: () -> Unit) {
    val target = ConversationTarget.parse(preview.obj("target"))
    var discardChanges by remember(target) { mutableStateOf(false) }
    var deleteRemote by remember(target) { mutableStateOf(false) }
    var deleting by remember(target) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        when {
            busy -> {
                CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                Text(if (deleting) "Deleting worktree…" else "Closing session…", Modifier.align(Alignment.CenterHorizontally))
            }
            target == null -> {
                Text("Session details are unavailable. Try again.")
                TextButton(onClick = cancel) { Text("Cancel") }
            }
            else -> {
                Text("This session uses the linked worktree ${preview.string("branch").ifBlank { "(detached)" }}.")
                Text("Deleting the worktree also deletes its local branch. Keeping it leaves your files in place.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (preview.optBoolean("hasChanges")) {
                    ListItem(headlineContent = { Text("Discard uncommitted changes") }, trailingContent = { Switch(checked = discardChanges, onCheckedChange = null) }, modifier = Modifier.toggleable(discardChanges, role = Role.Switch) { discardChanges = it })
                }
                if (preview.string("upstream").isNotBlank()) {
                    ListItem(headlineContent = { Text("Also delete ${preview.string("upstream")}") }, trailingContent = { Switch(checked = deleteRemote, onCheckedChange = null) }, modifier = Modifier.toggleable(deleteRemote, role = Role.Switch) { deleteRemote = it })
                }
                TextButton(onClick = { deleting = false; confirm(json("type" to "confirmCloseSession", "agentId" to target.agentId, "deleteWorktree" to false)) }) { Text("Keep Worktree and Close") }
                TextButton(enabled = !preview.optBoolean("hasChanges") || discardChanges, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error), onClick = {
                    deleting = true
                    confirm(json("type" to "confirmCloseSession", "agentId" to target.agentId, "deleteWorktree" to true, "deleteRemoteBranch" to deleteRemote, "discardChanges" to discardChanges))
                }) { Text("Delete Worktree and Close") }
                if (failed) Text("Couldn’t close this session. Check the connection and worktree status, then try again.", color = MaterialTheme.colorScheme.error)
                TextButton(onClick = cancel) { Text("Cancel") }
            }
        }
    }
}
