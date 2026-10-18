package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.FolderOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** Consent is local to the complete preview target; the shared engine validates the mutation. */
@Composable internal fun CloseSessionContent(preview: JSONObject, busy: Boolean, failed: Boolean, productName: String, confirm: (JSONObject) -> Unit, cancel: () -> Unit) {
    val target = ConversationTarget.parse(preview.obj("target"))
    var discardChanges by remember(target) { mutableStateOf(false) }
    var deleteRemote by remember(target) { mutableStateOf(false) }
    var deleting by remember(target) { mutableStateOf(false) }
    when {
        busy -> AppProgress(if (deleting) "Deleting worktree" else "Closing session", if (deleting) Icons.Outlined.FolderOff else Icons.Outlined.CheckCircle,
            if (deleting) "$productName is removing the worktree and closing the session." else "$productName is closing the session.", Modifier.heightIn(min = 320.dp), branch = preview.string("branch"))
        target == null -> AppSection { AppRow("Session details are unavailable. Try again."); AppDivider(); AppRow("Cancel", titleColor = MaterialTheme.colorScheme.primary, onClick = cancel) }
        else -> Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState())) {
            AppSection {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("This session uses the linked worktree ${preview.string("branch").ifBlank { "(detached)" }}.", fontSize = 17.sp)
                    Text("Deleting the worktree also deletes its local branch. Keeping it leaves your files in place.", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (preview.optBoolean("hasChanges") || preview.string("upstream").isNotBlank()) AppSection {
                if (preview.optBoolean("hasChanges")) AppRow("Discard uncommitted changes", Modifier.toggleable(discardChanges, role = Role.Switch) { discardChanges = it }, trailing = { Switch(checked = discardChanges, onCheckedChange = null) })
                if (preview.optBoolean("hasChanges") && preview.string("upstream").isNotBlank()) AppDivider()
                if (preview.string("upstream").isNotBlank()) AppRow("Also delete ${preview.string("upstream")}", Modifier.toggleable(deleteRemote, role = Role.Switch) { deleteRemote = it }, trailing = { Switch(checked = deleteRemote, onCheckedChange = null) })
            }
            AppSection {
                AppRow("Keep Worktree and Close", titleColor = MaterialTheme.colorScheme.primary, onClick = { deleting = false; confirm(json("type" to "confirmCloseSession", "agentId" to target.agentId, "deleteWorktree" to false)) })
                AppDivider()
                AppRow("Delete Worktree and Close", titleColor = MaterialTheme.colorScheme.error, enabled = !preview.optBoolean("hasChanges") || discardChanges, onClick = {
                    deleting = true
                    confirm(json("type" to "confirmCloseSession", "agentId" to target.agentId, "deleteWorktree" to true, "deleteRemoteBranch" to deleteRemote, "discardChanges" to discardChanges))
                })
            }
            if (failed) Text("The session couldn’t be closed. Check the connection and worktree status, then try again.", Modifier.padding(horizontal = 32.dp, vertical = 12.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
        }
    }
}
