package com.nabocorp.companion

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMerge
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable internal fun DrawerContent(model: CompanionModel, close: () -> Unit) {
    val state = model.state
    val sidebar = model.sidebar
    val activity = sidebar.organization == "activity"
    Column(Modifier.fillMaxHeight().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.app_icon), model.product.string("name"), Modifier.size(28.dp).clip(RoundedCornerShape(7.dp)))
            Spacer(Modifier.width(14.dp))
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                state.items("teams").forEach { team ->
                    val selected = team.string("id") == state.string("teamId")
                    val unread = team.optBoolean("isUnread") && !selected
                    Row(Modifier.heightIn(min = 48.dp).clip(CircleShape)
                        .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerLow)
                        .selectable(selected = selected, role = Role.Tab, onClick = { model.command("selectTeam", "id" to team.string("id")) })
                        .semantics { contentDescription = team.string("name") + if (unread) ", unread activity" else "" }
                        .padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(team.string("name"), color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface, maxLines = 1)
                        if (unread) UnreadDot()
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            var viewMenu by remember(sidebar.owner) { mutableStateOf(false) }
            val label = if (activity) "Activity" else "Repository"
            Box {
                TextButton(onClick = { viewMenu = true }, modifier = Modifier.semantics { contentDescription = "Agent view: $label" }) { Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant); Spacer(Modifier.width(4.dp)); Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                DropdownMenu(expanded = viewMenu, onDismissRequest = { viewMenu = false }) {
                    listOf("activity" to "Activity", "repository" to "Repository").forEach { (mode,title) ->
                        DropdownMenuItem(text = { Text(title) }, trailingIcon = { if (sidebar.organization == mode) Icon(Icons.Outlined.Check, null) }, onClick = { viewMenu = false; sidebar.organize(mode) })
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            if (activity) IconButton(onClick = { model.openCreation(CreationKind.QUICK); close() }, enabled = model.canStartCreation) { Icon(Icons.Outlined.Edit, "New chat") }
        }
        var repositoryMenu by remember(sidebar.owner) { mutableStateOf<JSONObject?>(null) }
        val repositories = state.items("groups").flatMap { group -> group.items("sessions").map { it.string("agentId") to group } }.toMap()
        LazyColumn(Modifier.weight(1f)) {
            val groups = state.items(if (activity) "activityGroups" else "groups").filter { !activity || it.items("sessions").isNotEmpty() }
            groups.forEach { group ->
                item(key = "group:${group.string("id")}") {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (activity) {
                            val category = group.string("activity")
                            val tone = when (category) { "attention" -> CompanionColors.attention; "working" -> CompanionColors.worktree; "recent" -> CompanionColors.addedLines; else -> MaterialTheme.colorScheme.onSurfaceVariant }
                            if (category == "working" && model.drawerVisible && model.foreground) CircularProgressIndicator(Modifier.size(16.dp), color = tone, strokeWidth = 2.dp)
                            else Icon(when (category) { "attention" -> Icons.Outlined.NotificationsActive; "working" -> Icons.Outlined.Sync; "recent" -> Icons.Outlined.CheckCircle; else -> Icons.Outlined.Bedtime }, null, Modifier.size(18.dp), tint = tone)
                            Spacer(Modifier.width(8.dp))
                        } else {
                            DrawerGroupIcon(group)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(group.string("label"), Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (activity && group.string("activity") == "idle") Box {
                            var sortMenu by remember(sidebar.owner) { mutableStateOf(false) }
                            IconButton(onClick = { sortMenu = true }, modifier = Modifier.semantics { contentDescription = "Sort Idle agents"; stateDescription = if (sidebar.idleSort == "activity") "Recent activity" else "Repository" }) { Icon(Icons.Outlined.SwapVert, null) }
                            DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                                listOf("activity" to "Recent activity", "repository" to "Repository").forEach { (order,title) ->
                                    DropdownMenuItem(text = { Text(title) }, trailingIcon = { if (sidebar.idleSort == order) Icon(Icons.Outlined.Check, null) }, onClick = { sortMenu = false; model.chooseSidebarIdleSort(order) })
                                }
                            }
                        }
                        if (!activity && group.string("kind") == "quickChats" && group.items("sessions").isNotEmpty()) {
                            IconButton(onClick = { model.openCreation(CreationKind.QUICK); close() }, enabled = model.canStartCreation) { Icon(Icons.Outlined.Add, "New chat") }
                        }
                        if (!activity && group.string("kind") == "repository") Box {
                            IconButton(onClick = { repositoryMenu = group }, enabled = model.canStartCreation && group.string("repositoryRoot").isNotBlank()) { Icon(Icons.Outlined.Add, "New agent in ${group.string("label")}") }
                            DropdownMenu(expanded = repositoryMenu?.string("id") == group.string("id"), onDismissRequest = { repositoryMenu = null }) {
                                listOf("Default Branch" to CreationKind.DEFAULT, "Existing Branch" to CreationKind.EXISTING, "New Worktree" to CreationKind.WORKTREE).forEach { (label, kind) ->
                                    DropdownMenuItem(text = { Text(label) }, onClick = { repositoryMenu = null; model.openCreation(kind, group.string("repositoryRoot"), group.string("label")); close() })
                                }
                            }
                        }
                    }
                }
                group.items("sessions").forEach { session ->
                    item(key = "agent:${session.string("agentId")}") {
                        DrawerSessionRow(session, group, repositories[session.string("agentId")], activity, model) { model.selectAgent(session.string("agentId")); close() }
                    }
                }
            }
        }
        if (model.drawerVisible && model.showConnectionLost) Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Connection lost", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { model.command("reconnect") }, modifier = Modifier.semantics { contentDescription = "Reconnect computer" }) { Text("Reconnect") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            var newMenu by remember { mutableStateOf(false) }
            Box(Modifier.weight(1f)) {
                FilledTonalButton(onClick = { newMenu = true }, enabled = model.canStartCreation) { Icon(Icons.Outlined.Add, null); Text("New agent") }
                DropdownMenu(expanded = newMenu, onDismissRequest = { newMenu = false }) {
                    listOf("Quick Chat" to CreationKind.QUICK, "New Project" to CreationKind.PROJECT, "From GitHub" to CreationKind.GITHUB, "From URL" to CreationKind.URL).forEachIndexed { index, (label, kind) ->
                        if (index == 1) HorizontalDivider()
                        DropdownMenuItem(text = { Text(label) }, onClick = { newMenu = false; model.openCreation(kind); close() })
                    }
                }
            }
            IconButton(onClick = { model.sheet = "settings"; close() }, modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerLow, CircleShape)) { Icon(Icons.Outlined.Settings, "Settings") }
        }
    }
}

@Composable private fun UnreadDot() {
    Box(Modifier.size(6.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
}

/** Repository icons are display data, never host paths or remote fetch instructions. */
@Composable private fun DrawerGroupIcon(group: JSONObject?) {
    val icon = group?.string("icon").orEmpty()
    val quick = group?.string("kind") == "quickChats"
    key(icon) {
        val bitmap by produceState<Bitmap?>(null, icon) {
            if (icon.startsWith("data:image/", ignoreCase = true) && icon.length <= 4_000_000) {
                try { value = ImagePreviewLoader.load(ImagePreview.Source.Displayed(icon), maxDimension = 128) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Invalid display data uses the ordinary group fallback. */ }
            }
        }
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            when {
                bitmap != null -> Image(bitmap!!.asImageBitmap(), null, Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)))
                icon.isNotBlank() && icon.length <= 32 && !icon.contains(':') -> {
                    val badge = icon.any { it.isLetterOrDigit() }
                    Box(Modifier.fillMaxSize().then(if (badge) Modifier.background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(5.dp)) else Modifier), contentAlignment = Alignment.Center) {
                        Text(icon, maxLines = 1, overflow = TextOverflow.Clip, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                else -> Icon(if (quick) Icons.Outlined.ChatBubbleOutline else Icons.Outlined.FolderOpen, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable private fun DrawerSessionRow(session: JSONObject, group: JSONObject, repository: JSONObject?, activity: Boolean, model: CompanionModel, select: () -> Unit) {
    val status = session.obj("status").string("type")
    val unread = session.optBoolean("isUnread")
    val kind = session.string("kind")
    val repositoryRow = !activity && group.string("kind") == "repository"
    val selected = session.string("agentId") == model.state.string("agentId")
    val description = when (status) { "working" -> "Working"; "awaitingInput" -> "Needs input"; "error" -> "Error"; else -> "Idle" } +
        (if (unread) ", unread" else "") + if (repositoryRow && kind in listOf("main", "branch", "worktree", "detached", "folder")) ", ${kind.replaceFirstChar { it.uppercase() }}" else ""
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp).clip(RoundedCornerShape(12.dp))
        .background(if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.background)
        .selectable(selected = selected, role = Role.Button, onClick = select).semantics { stateDescription = description }
        .heightIn(min = if (activity) 52.dp else 48.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (repositoryRow) {
            val tint = when (kind) { "main" -> MaterialTheme.colorScheme.primary; "branch" -> CompanionColors.addedLines; "worktree" -> CompanionColors.worktree; else -> MaterialTheme.colorScheme.onSurfaceVariant }
            Icon(when (kind) { "worktree" -> Icons.Outlined.AccountTree; "folder" -> Icons.Outlined.FolderOpen; else -> Icons.AutoMirrored.Outlined.CallMerge }, null, Modifier.size(22.dp), tint = tint)
        } else DrawerGroupIcon(repository ?: group)
        Column(Modifier.weight(1f)) {
            Text(session.string("displayTitle"), fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (activity && session.string("subtitle").isNotBlank()) Text(session.string("subtitle"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (unread) UnreadDot()
        if (repositoryRow && status == "working" && model.drawerVisible && model.foreground) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        if (repositoryRow && status == "awaitingInput") Surface(shape = RoundedCornerShape(5.dp), color = CompanionColors.attention.copy(alpha = 0.12f)) {
            Text("Input", Modifier.padding(horizontal = 5.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = CompanionColors.attention)
        }
        if (status == "error") Icon(Icons.Outlined.ErrorOutline, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
    }
}
