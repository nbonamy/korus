package com.nabocorp.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun QueuedPromptsContent(prompts: List<JSONObject>, target: ConversationTarget?, canManage: Boolean, pending: String?, failed: Boolean, dispatch: (JSONObject) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (prompts.isNotEmpty()) Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.Inbox, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Queued · ${prompts.size}", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 88.dp)) {
                itemsIndexed(prompts, key = { _, it -> it.string("id") }) { index, prompt ->
                    val text = prompt.string("text")
                    val enabled = canManage && target != null && pending == null
                    fun update(action: String) {
                        if (enabled && target != null) dispatch(json("type" to "queuedPrompt", "target" to target.toJson(), "promptId" to prompt.string("id"), "action" to action))
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).alpha(if (pending == prompt.string("id")) 0.4f else 1f), verticalAlignment = Alignment.CenterVertically) {
                        Text(text.replace('\n', ' '), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 16.sp)
                        QueueAction(Icons.Outlined.ArrowUpward, "Steer queued message: $text", enabled, true) { update("steer") }
                        QueueAction(Icons.Outlined.DeleteOutline, "Delete queued message: $text", enabled, false) { update("delete") }
                    }
                    if (index < prompts.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
        if (failed) Text("Queue change couldn’t be confirmed. Check the queue before trying again.", Modifier.padding(horizontal = 18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
    }
}

@Composable private fun QueueAction(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, enabled: Boolean, accent: Boolean, onClick: () -> Unit) {
    val tint = if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Box(Modifier.size(44.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp).background(tint.copy(alpha = if (accent) 0.1f else 0.08f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(18.dp), tint = tint.copy(alpha = if (enabled) 1f else 0.38f))
        }
    }
}
