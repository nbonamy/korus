package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
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

/** The missions, in the main area where a conversation would be: the list, or one mission with its tickets. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun MissionsScreen(model: CompanionModel, openDrawer: () -> Unit) {
    val detail = model.missionDetail?.let { id -> model.missions.firstOrNull { it.string("id") == id } }
    val active = model.missions.count { it.isActiveMission }
    BackHandler { if (model.missionDetail != null) model.missionDetail = null else model.missionsOpen = false }
    Scaffold(topBar = {
        CenterAlignedTopAppBar(
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background, scrolledContainerColor = MaterialTheme.colorScheme.background),
            title = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (detail != null) "Mission" else "Missions", Modifier.semantics { heading() }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (detail == null && active > 0) Text("$active active", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = {
                if (detail != null) IconButton(onClick = { model.missionDetail = null }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to missions") }
                else IconButton(onClick = openDrawer) { Icon(Icons.Outlined.Menu, "Open workspace") }
            },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())) {
            if (detail != null) MissionDetail(model, detail) else MissionList(model)
        }
    }
}

@Composable private fun SectionLabel(text: String) {
    Text(text.uppercase(), Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp).semantics { heading() },
        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun MissionList(model: CompanionModel) {
    val (active, completed) = model.missions.partition { it.isActiveMission }
    if (model.missions.isEmpty()) Text("No missions", Modifier.fillMaxWidth().padding(48.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (active.isNotEmpty()) { SectionLabel("Active"); active.forEach { MissionRow(it) { model.missionDetail = it.string("id") } } }
    if (completed.isNotEmpty()) { SectionLabel("Completed"); completed.forEach { MissionRow(it) { model.missionDetail = it.string("id") } } }
}

@Composable private fun MissionProgressBar(mission: JSONObject) {
    if (mission.items("tickets").isNotEmpty()) LinearProgressIndicator(progress = { mission.missionProgress }, Modifier.fillMaxWidth().height(3.dp),
        color = if (mission.isActiveMission) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, drawStopIndicator = {})
}

@Composable private fun MissionRow(mission: JSONObject, open: () -> Unit) {
    val tone = if (mission.isActiveMission) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(mission.string("outcome"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = tone, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(mission.missionSummary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            MissionProgressBar(mission)
        }
        Spacer(Modifier.width(8.dp))
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable private fun MissionDetail(model: CompanionModel, mission: JSONObject) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(mission.string("outcome"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Text(mission.missionSummary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        MissionProgressBar(mission)
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
    val tickets = mission.items("tickets")
    if (tickets.isNotEmpty()) { SectionLabel("Tickets"); tickets.forEach { TicketRow(model, it) } }
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
        .padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Icon(state.icon, null, Modifier.size(22.dp), tint = tint)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text("%02d %s".format(ticket.optInt("number"), ticket.string("title")), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(state.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (agentId.isNotBlank()) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
