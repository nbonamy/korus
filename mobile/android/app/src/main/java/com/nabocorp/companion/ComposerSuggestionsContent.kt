package com.nabocorp.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable internal fun ComposerSuggestionsContent(query: ComposerQuery, status: String, items: List<ComposerSuggestion>,
    choose: (ComposerSuggestion) -> Unit, dismiss: () -> Unit, retry: () -> Unit) {
    val matches = query.matches(items)
    Surface(shape = RoundedCornerShape(20.dp), tonalElevation = 3.dp) {
        Column {
            Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (query.isSkill) "Skills" else "Agents & Plugins", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                IconButton(onClick = dismiss) { Icon(Icons.Outlined.Close, "Dismiss suggestions") }
            }
            if (matches.isNotEmpty()) LazyColumn(Modifier.heightIn(max = 240.dp)) {
                listOf("skill" to "Skills", "agent" to "Agents", "plugin" to "Plugins").forEach { (kind, title) ->
                    val group = matches.filter { it.kind == kind }
                    if (group.isNotEmpty()) {
                        if (!query.isSkill) item(key = "heading:$kind") { Text(title, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        group.forEach { item -> item(key = "$kind:${item.id}") {
                            ListItem(headlineContent = { Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                supportingContent = if (item.description.isNotBlank()) ({ Text(item.description, maxLines = 1, overflow = TextOverflow.Ellipsis) }) else null,
                                leadingContent = { Icon(when (kind) { "skill" -> Icons.Outlined.AutoAwesome; "agent" -> Icons.Outlined.PersonOutline; else -> Icons.Outlined.Extension }, null, Modifier.size(20.dp)) },
                                modifier = Modifier.clickable(role = Role.Button) { choose(item) }, colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainer))
                        } }
                    }
                }
            }
            when (status) {
                "idle", "loading" -> Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(if (query.isSkill) "Loading skills…" else "Loading plugins…", style = MaterialTheme.typography.bodySmall)
                }
                "failed" -> Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (query.isSkill) "Couldn’t load skills." else "Couldn’t load plugins.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = retry) { Text("Retry") }
                }
                else -> if (matches.isEmpty()) Text(if (query.isSkill) "No matching skills." else "No matching agents or plugins.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
