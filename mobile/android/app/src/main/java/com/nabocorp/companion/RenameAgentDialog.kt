package com.nabocorp.companion

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

internal data class AgentRename(val target: ConversationTarget, val name: String)

@Composable internal fun RenameAgentDialog(model: CompanionModel, draft: AgentRename) {
    var name by remember(draft.target) { mutableStateOf(draft.name) }
    AlertDialog(onDismissRequest = { model.agentRename = null }, title = { Text("Rename Agent") },
        text = { OutlinedTextField(name, { name = it }, Modifier.testTag("agent-name"), label = { Text("Agent name") }, singleLine = true) },
        confirmButton = { TextButton(enabled = model.canManageSession && name.trim().isNotEmpty() && name.trim().length <= 200,
            onClick = { model.renameAgent(draft.target, name.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { model.agentRename = null }) { Text("Cancel") } })
}
