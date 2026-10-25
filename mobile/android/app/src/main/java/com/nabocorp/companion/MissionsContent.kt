package com.nabocorp.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** How a mission ticket reads on the phone: one label and icon per state of the desktop's implementation board. */
internal enum class TicketState(val label: String, val icon: ImageVector) {
    Blocked("Blocked", Icons.Outlined.Lock),
    Queued("Queued", Icons.Outlined.RadioButtonUnchecked),
    Preparing("Preparing", Icons.Outlined.Sync),
    Running("In progress", Icons.Outlined.Sync),
    AwaitingReview("Ready for review", Icons.Outlined.Visibility),
    Accepted("Done", Icons.Outlined.CheckCircle),
    Cancelled("Cancelled", Icons.Outlined.Block),
    Failed("Failed", Icons.Outlined.ErrorOutline);

    companion object {
        /** A state this build does not know reads as waiting rather than as a failure. */
        fun of(value: String) = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: Queued
    }
}

internal val JSONObject.isActiveMission get() = string("status") == "active"
internal val JSONObject.missionProgress: Float get() = items("tickets").let { if (it.isEmpty()) 0f else optInt("done").toFloat() / it.size }

private val stageLabels = mapOf("requirements" to "Requirements", "tickets" to "Tickets", "implementation" to "Implementation", "review" to "Review", "ship" to "Ship")

/** "Implementation · 3 of 7 tickets"; a mission still shaping its tickets says only where it is. */
internal val JSONObject.missionSummary: String get() {
    val stage = string("stage").let { stageLabels[it] ?: it.replaceFirstChar(Char::uppercase) }
    val total = items("tickets").size
    return if (total == 0) stage else "$stage · ${optInt("done")} of $total ${if (total == 1) "ticket" else "tickets"}"
}

@Composable internal fun MissionsContent(model: CompanionModel) {
    val detail = model.missionDetail?.let { id -> model.missions.firstOrNull { it.string("id") == id } }
    if (detail != null) MissionDetail(model, detail) else MissionList(model)
}

@Composable private fun MissionList(model: CompanionModel) {
    val (active, completed) = model.missions.partition { it.isActiveMission }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        active.forEach { MissionRow(it) { model.missionDetail = it.string("id") } }
        if (completed.isNotEmpty()) {
            Text("Completed", Modifier.padding(start = 4.dp, top = 12.dp).semantics { heading() }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            completed.forEach { MissionRow(it) { model.missionDetail = it.string("id") } }
        }
    }
}

@Composable private fun MissionRow(mission: JSONObject, open: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.clickable(onClick = open).padding(16.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(mission.string("outcome"), style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(mission.missionSummary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (mission.items("tickets").isNotEmpty()) LinearProgressIndicator(progress = { mission.missionProgress }, Modifier.fillMaxWidth(),
                    color = if (mission.isActiveMission) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
            }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun MissionDetail(model: CompanionModel, mission: JSONObject) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(mission.string("outcome"), style = MaterialTheme.typography.titleMedium)
                Text(mission.missionSummary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (mission.items("tickets").isNotEmpty()) LinearProgressIndicator(progress = { mission.missionProgress }, Modifier.fillMaxWidth(),
                    color = if (mission.isActiveMission) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
            }
        }
        val tickets = mission.items("tickets")
        if (tickets.isNotEmpty()) {
            Text("Tickets", Modifier.padding(start = 4.dp, top = 12.dp).semantics { heading() }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column { tickets.forEach { TicketRow(model, it) } }
            }
        }
    }
}

@Composable private fun TicketRow(model: CompanionModel, ticket: JSONObject) {
    val state = TicketState.of(ticket.string("state"))
    val agentId = ticket.string("agentId")
    val tint = when (state) {
        TicketState.Accepted -> CompanionColors.addedLines
        TicketState.Failed -> MaterialTheme.colorScheme.error
        TicketState.AwaitingReview -> CompanionColors.attention
        TicketState.Running, TicketState.Preparing -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(Modifier.fillMaxWidth().then(if (agentId.isNotBlank()) Modifier.clickable { model.openTicket(agentId) } else Modifier)
        .padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Icon(state.icon, null, Modifier.size(24.dp), tint = tint)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text("%02d %s".format(ticket.optInt("number"), ticket.string("title")), style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(state.label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (agentId.isNotBlank()) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
