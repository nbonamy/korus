package com.nabocorp.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ConversationHeader(model: CompanionModel, openWorkspace: () -> Unit) {
    val state = model.state
    val unread = state.items("teams").any { it.optBoolean("isUnread") }
    val dirty = state.obj("git").obj("uncommitted").string("state") == "dirty"
    val preparing = state.string("sessionAction") == "previewClose" || model.duplicatingAgent
    CenterAlignedTopAppBar(
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background, scrolledContainerColor = MaterialTheme.colorScheme.background),
        title = {
            val header = state.obj("header")
            val subtitle = listOf(header.string("repository"), header.string("statusText")).filter { it.isNotBlank() }.joinToString(" · ")
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(header.string("title").ifBlank { model.productName }, Modifier.semantics { heading() }, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (subtitle.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    val status = header.string("status")
                    if (status in listOf("working", "awaitingInput", "error")) {
                        Box(Modifier.size(6.dp).background(if (status == "error") MaterialTheme.colorScheme.error else CompanionColors.worktree, CircleShape).clearAndSetSemantics {})
                    }
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        },
        navigationIcon = {
            val mission = model.workerMission
            if (mission == null) HeaderButton(Icons.Outlined.Menu, "Open workspace", if (unread) "Unread activity" else "", unread, action = openWorkspace)
            else HeaderButton(Icons.AutoMirrored.Outlined.ArrowBack, "Back to mission", "", false) { model.showMissions(mission.string("id")) }
        },
        actions = {
            // A mission drives its workers: the phone can look at their changes and nothing else.
            val worker = model.workerMission != null
            if (!worker || state.obj("git").optBoolean("available")) Box {
                val description = listOfNotNull(if (dirty) "Uncommitted changes" else null, if (model.duplicatingAgent) "Duplicating agent" else if (preparing) "Preparing to close session" else null).joinToString(", ")
                HeaderButton(Icons.Outlined.MoreHoriz, "Conversation actions", description, dirty, preparing) { model.sheet = "conversation" }
                DropdownMenu(expanded = model.sheet == "conversation", onDismissRequest = model::dismissSheet) {
                    if (state.obj("git").optBoolean("available")) {
                        DropdownMenuItem(text = { Text("Changes") }, leadingIcon = { Icon(Icons.Outlined.Difference, null) }, enabled = model.canManageSession, onClick = model::openChanges)
                        if (!worker) HorizontalDivider()
                    }
                    if (!worker) {
                    DropdownMenuItem(text = { Text("Rename Agent") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, enabled = model.canManageSession, onClick = model::openAgentRename)
                    DropdownMenuItem(text = { Text("Duplicate Agent") }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) }, enabled = model.canManageSession && model.canStartCreation, onClick = model::duplicateAgent)
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Restart Session") }, leadingIcon = { Icon(Icons.Outlined.RestartAlt, null) }, enabled = model.canRestartSession, onClick = model::restartSession)
                    DropdownMenuItem(text = { Text("Close Session") }, leadingIcon = { Icon(Icons.Outlined.Close, null) },
                        colors = MenuDefaults.itemColors(textColor = MaterialTheme.colorScheme.error, leadingIconColor = MaterialTheme.colorScheme.error),
                        enabled = model.canManageSession, onClick = model::closeSession)
                    }
                }
            }
        },
    )
}

@Composable private fun HeaderButton(icon: ImageVector, description: String, information: String, dot: Boolean, loading: Boolean = false, action: () -> Unit) {
    Box(Modifier.padding(horizontal = 4.dp)) {
        IconButton(onClick = action, modifier = Modifier.size(48.dp).background(MaterialTheme.colorScheme.surfaceContainerLow, CircleShape)
            .semantics { contentDescription = description; stateDescription = information }) {
            if (loading) CircularProgressIndicator(Modifier.size(20.dp).clearAndSetSemantics {}, strokeWidth = 2.dp)
            else Icon(icon, null, tint = MaterialTheme.colorScheme.onSurface)
        }
        if (dot) Box(Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp).size(12.dp).background(MaterialTheme.colorScheme.background, CircleShape).padding(2.dp).background(CompanionColors.unread, CircleShape).clearAndSetSemantics {})
    }
}
