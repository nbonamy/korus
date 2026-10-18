package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable internal fun QueuedPromptsContent(prompts: List<JSONObject>, target: ConversationTarget?, canManage: Boolean, pending: String?, failed: Boolean, dispatch: (JSONObject) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (prompts.isNotEmpty()) {
            Text("Queued · ${prompts.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 96.dp)) {
                items(prompts, key = { it.string("id") }) { prompt ->
                    val text = prompt.string("text")
                    val enabled = canManage && target != null && pending == null
                    fun update(action: String) {
                        if (enabled && target != null) dispatch(json("type" to "queuedPrompt", "target" to target.toJson(), "promptId" to prompt.string("id"), "action" to action))
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(text.replace('\n', ' '), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        IconButton(onClick = { update("steer") }, enabled = enabled) { Icon(Icons.Outlined.ArrowUpward, "Steer queued message: $text") }
                        IconButton(onClick = { update("delete") }, enabled = enabled) { Icon(Icons.Outlined.DeleteOutline, "Delete queued message: $text") }
                    }
                }
            }
        }
        if (failed) Text("Queue change couldn’t be confirmed. Check the queue before trying again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
}
