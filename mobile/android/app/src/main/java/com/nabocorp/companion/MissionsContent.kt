package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Instant

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

internal val JSONObject.attentionCount get() = items("tickets").count { TicketState.of(it.string("state")) in listOf(TicketState.AwaitingReview, TicketState.Failed) }
internal val JSONObject.workingCount get() = items("tickets").count { TicketState.of(it.string("state")) in listOf(TicketState.Running, TicketState.Preparing) }
/** Ready once the mission has reached its ship stage: finished tickets still owe a review. */
internal val JSONObject.isReadyToShip get() = isActiveMission && string("stage") == "ship"
/** Every ticket is accepted, whatever stage the mission is in. */
internal val JSONObject.allTicketsDone get() = items("tickets").let { it.isNotEmpty() && optInt("done") >= it.size }
internal val JSONObject.canContinueToReview get() = isActiveMission && string("next") == "review"
internal val JSONObject.shipsOnDesktop get() = isActiveMission && string("next") == "ship"

private val stages = listOf("requirements" to ("Requirements" to Icons.Outlined.Description), "tickets" to ("Tickets" to Icons.Outlined.Checklist),
    "implementation" to ("Implementation" to Icons.Outlined.Construction), "review" to ("Review" to Icons.Outlined.Visibility), "ship" to ("Ship" to Icons.AutoMirrored.Outlined.Send))
internal val JSONObject.stageIndex get() = stages.indexOfFirst { it.first == string("stage") }.coerceAtLeast(0)

/** "11 Update onboarding copy": the ticket an agent is on, the first one when several are. */
internal val JSONObject.nowLine: String? get() = items("tickets").firstOrNull { TicketState.of(it.string("state")) in listOf(TicketState.Running, TicketState.Preparing) }
    ?.let { "%02d %s".format(it.optInt("number"), it.string("title")) }

private fun parseInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()

/** How long the work has been going: until now while it runs, until its last change once it is over. */
internal fun JSONObject.elapsedMillis(now: Instant): Long? {
    val start = parseInstant(string("startedAt")) ?: return null
    val end = if (isActiveMission) now else parseInstant(string("updatedAt")) ?: now
    return (end.toEpochMilli() - start.toEpochMilli()).coerceAtLeast(0)
}

/** "2h 14m", "14m", or "Under a minute". */
internal fun elapsedText(millis: Long): String {
    val minutes = (millis / 60_000).toInt()
    return when {
        minutes < 1 -> "Under a minute"
        minutes < 60 -> "${minutes}m"
        minutes < 24 * 60 -> "${minutes / 60}h ${minutes % 60}m"
        else -> "${minutes / (24 * 60)}d ${minutes % (24 * 60) / 60}h"
    }
}

@Composable private fun ticketTint(state: TicketState) = when (state) {
    TicketState.Accepted -> CompanionColors.addedLines
    TicketState.Failed -> MaterialTheme.colorScheme.error
    TicketState.AwaitingReview -> CompanionColors.worktree
    TicketState.Running, TicketState.Preparing -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** The missions, in the main area where a conversation would be: the list, or one mission with its stage and tickets. */
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
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (detail != null) MissionDetail(model, detail) else MissionList(model)
        }
    }
}

/** How far a mission has come: a ring that fills with accepted tickets, the count in its center, a check once everything is done. */
@Composable private fun MissionGauge(mission: JSONObject, size: Dp = 64.dp, stroke: Dp = 7.dp) {
    val tickets = mission.items("tickets")
    val tint = when { !mission.isActiveMission -> MaterialTheme.colorScheme.outline; mission.allTicketsDone -> CompanionColors.addedLines; else -> MaterialTheme.colorScheme.primary }
    val progress by animateFloatAsState(mission.missionProgress.coerceIn(0f, 1f), label = "mission progress")
    Box(Modifier.size(size).semantics(mergeDescendants = true) { contentDescription = "${mission.optInt("done")} of ${tickets.size} tickets done" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(stroke / 2)) {
            val line = Stroke(width = stroke.toPx(), cap = StrokeCap.Round)
            drawArc(tint.copy(alpha = 0.15f), 0f, 360f, false, style = line, size = Size(this.size.width, this.size.height), topLeft = Offset.Zero)
            if (progress > 0f) drawArc(tint, -90f, 360f * progress, false, style = line, size = Size(this.size.width, this.size.height), topLeft = Offset.Zero)
        }
        when {
            tickets.isEmpty() -> Icon(Icons.Outlined.MoreHoriz, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            mission.allTicketsDone -> Icon(Icons.Outlined.Check, null, Modifier.size(size * 0.38f), tint = tint)
            else -> Text("${mission.optInt("done")}/${tickets.size}", fontSize = (size.value * 0.27f).sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable private fun PulsingDot(color: Color = MaterialTheme.colorScheme.primary) {
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(1f, 0.3f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
    Box(Modifier.size(7.dp).alpha(pulse).background(color, CircleShape).clearAndSetSemantics {})
}

@Composable private fun SectionLabel(text: String) {
    Text(text.uppercase(), Modifier.padding(start = 4.dp, top = 8.dp).semantics { heading() },
        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun MissionList(model: CompanionModel) {
    val (active, completed) = model.missions.partition { it.isActiveMission }
    val attention = active.filter { it.attentionCount > 0 }
    if (model.missions.isEmpty()) Text("No missions", Modifier.fillMaxWidth().padding(48.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    attention.firstOrNull()?.let { first -> AttentionStrip(attention.sumOf { it.attentionCount }) { model.missionDetail = first.string("id") } }
    active.forEach { MissionCard(it) { model.missionDetail = it.string("id") } }
    if (completed.isNotEmpty()) { SectionLabel("Completed"); completed.forEach { CompletedRow(it) { model.missionDetail = it.string("id") } } }
}

@Composable private fun AttentionStrip(count: Int, open: () -> Unit) {
    val tone = CompanionColors.worktree
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(tone.copy(alpha = 0.12f)).clickable(onClick = open).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.ErrorOutline, null, tint = tone)
        Spacer(Modifier.width(10.dp))
        Text(if (count == 1) "1 ticket needs you" else "$count tickets need you", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = tone)
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = tone)
    }
}

@Composable private fun MissionCard(mission: JSONObject, open: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.clickable(onClick = open).padding(20.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            MissionGauge(mission)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(mission.string("outcome"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val now = mission.nowLine
                when {
                    mission.isReadyToShip -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CheckCircle, null, Modifier.size(16.dp), tint = CompanionColors.addedLines)
                        Spacer(Modifier.width(6.dp))
                        Text("Ready to ship", style = MaterialTheme.typography.labelMedium, color = CompanionColors.addedLines)
                    }
                    now != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                        PulsingDot(); Spacer(Modifier.width(6.dp))
                        Text(now, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    else -> Text(mission.missionSummary.substringBefore(" ·"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun CompletedRow(mission: JSONObject, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(horizontal = 14.dp, vertical = 12.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.width(12.dp))
        Text(mission.string("outcome"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun MissionDetail(model: CompanionModel, mission: JSONObject) {
    StageTracker(mission.stageIndex, finished = !mission.isActiveMission)
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(mission.string("outcome"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                MissionGauge(mission, 84.dp, 9.dp)
                Spacer(Modifier.width(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val total = mission.items("tickets").size
                    Text(if (total == 0) mission.missionSummary else "${mission.optInt("done")} of $total ${if (total == 1) "ticket" else "tickets"}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    var now by remember { mutableStateOf(Instant.now()) }
                    LaunchedEffect(Unit) { while (true) { delay(30_000); now = Instant.now() } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        mission.elapsedMillis(now)?.let { Chip(Icons.Outlined.Schedule, elapsedText(it)) }
                        if (mission.workingCount > 0) Chip(Icons.Outlined.Groups, "${mission.workingCount} working", MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
    NextStep(model, mission)
    mission.string("leadAgentId").takeIf { it.isNotBlank() }?.let { lead -> LeadRow(missionStage(mission)) { model.openTicket(lead) } }
    val tickets = mission.items("tickets")
    if (tickets.isNotEmpty()) {
        SectionLabel("Tickets")
        Column { tickets.forEachIndexed { index, ticket -> TicketRow(model, ticket, first = index == 0, last = index == tickets.lastIndex) } }
    }
}

private fun missionStage(mission: JSONObject) = stages.firstOrNull { it.first == mission.string("stage") }?.second?.first ?: mission.string("stage").replaceFirstChar(Char::uppercase)

/** The one move a phone can make on a mission: on to review. Shipping stays on the desktop, and says so. */
@Composable private fun NextStep(model: CompanionModel, mission: JSONObject) {
    var confirming by remember { mutableStateOf(false) }
    val working = model.state.string("missionAction") == "working"
    if (mission.canContinueToReview) {
        Button({ confirming = true }, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !working, shape = RoundedCornerShape(16.dp)) {
            if (working) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary); Spacer(Modifier.width(10.dp)) }
            Text("Continue to Review", fontWeight = FontWeight.SemiBold)
        }
        if (confirming) AlertDialog(onDismissRequest = { confirming = false }, title = { Text("Move this mission to review?") }, text = { Text("Implementation is complete. The review starts right away.") },
            confirmButton = { TextButton({ confirming = false; model.command("continueMission", "missionId" to mission.string("id")) }) { Text("Continue to Review") } },
            dismissButton = { TextButton({ confirming = false }) { Text("Cancel") } })
    } else if (mission.shipsOnDesktop) {
        Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton({}, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = false, shape = RoundedCornerShape(16.dp)) {
                Icon(Icons.Outlined.Lock, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Ship", fontWeight = FontWeight.SemiBold)
            }
            Text("Only available on desktop", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The agent leading the mission is one tap away, for a question or a change of direction. */
@Composable private fun LeadRow(stage: String, open: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.clickable(onClick = open).padding(horizontal = 16.dp, vertical = 14.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Forum, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Talk to the mission lead", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(stage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun Chip(icon: ImageVector, text: String, tint: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Row(Modifier.background(tint.copy(alpha = 0.12f), CircleShape).padding(horizontal = 9.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(14.dp), tint = tint); Spacer(Modifier.width(5.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = tint)
    }
}

@Composable private fun StageTracker(current: Int, finished: Boolean) {
    val line = MaterialTheme.colorScheme.outlineVariant
    Row(Modifier.fillMaxWidth()) {
        stages.forEachIndexed { index, (_, step) ->
            val done = finished || index < current; val isCurrent = !finished && index == current
            val (label, icon) = step
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) { contentDescription = "$label, ${if (done) "done" else if (isCurrent) "current" else "to come"}" }, horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.fillMaxWidth().height(30.dp), contentAlignment = Alignment.Center) {
                    Row(Modifier.fillMaxWidth()) {
                        Box(Modifier.weight(1f).height(2.dp).align(Alignment.CenterVertically).background(if (index == 0) Color.Transparent else if (index <= current || finished) CompanionColors.addedLines else line))
                        Box(Modifier.weight(1f).height(2.dp).align(Alignment.CenterVertically).background(if (index == stages.lastIndex) Color.Transparent else if (done) CompanionColors.addedLines else line))
                    }
                    Box(Modifier.size(30.dp).background(if (done) CompanionColors.addedLines else if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.background, CircleShape)
                        .then(if (!done && !isCurrent) Modifier.border(1.5.dp, line, CircleShape) else Modifier), contentAlignment = Alignment.Center) {
                        Icon(if (done) Icons.Outlined.Check else icon, null, Modifier.size(16.dp), tint = if (done || isCurrent) Color.White else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(label, style = MaterialTheme.typography.labelSmall, color = if (isCurrent) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The tickets in order along one line, so what is done, what is moving and what is waiting reads top to bottom. */
@Composable private fun TicketRow(model: CompanionModel, ticket: JSONObject, first: Boolean, last: Boolean) {
    val state = TicketState.of(ticket.string("state"))
    val agentId = ticket.string("agentId")
    val tint = ticketTint(state)
    val quiet = state in listOf(TicketState.Queued, TicketState.Blocked)
    val line = MaterialTheme.colorScheme.outlineVariant
    val after = (0 until (ticket.optJSONArray("after")?.length() ?: 0)).joinToString(", ") { "%02d".format(ticket.optJSONArray("after")!!.optInt(it)) }
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).then(if (agentId.isNotBlank()) Modifier.clickable { model.openTicket(agentId) } else Modifier).semantics(mergeDescendants = true) {}) {
        Column(Modifier.width(30.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.width(2.dp).height(10.dp).background(if (first) Color.Transparent else line))
            Box(Modifier.size(30.dp).background(tint.copy(alpha = if (quiet) 0.1f else 0.16f), CircleShape), contentAlignment = Alignment.Center) { Icon(state.icon, null, Modifier.size(16.dp), tint = tint) }
            Box(Modifier.width(2.dp).weight(1f).background(if (last) Color.Transparent else line))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("%02d %s".format(ticket.optInt("number"), ticket.string("title")), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(state.label + if (after.isNotEmpty()) " · after $after" else "", style = MaterialTheme.typography.bodySmall,
                color = if (quiet || state == TicketState.Accepted || state == TicketState.Cancelled) MaterialTheme.colorScheme.onSurfaceVariant else tint)
            ticket.string("activity").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (agentId.isNotBlank()) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.align(Alignment.CenterVertically), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Under a ticket worker's header: which ticket this is, and a way to accept it once its work is ready for review.
 * The mission's lead is a conversation like any other and gets none. */
@Composable internal fun MissionContextBar(model: CompanionModel) {
    val reference = model.workerMission ?: return
    if (reference.optBoolean("lead")) return
    val mission = model.missions.firstOrNull { it.string("id") == reference.string("id") } ?: return
    val ticket = mission.items("tickets").firstOrNull { it.string("agentId") == model.state.string("agentId") } ?: return
    val ready = TicketState.of(ticket.string("state")) == TicketState.AwaitingReview && ticket.string("runId").isNotBlank()
    var confirming by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(start = 16.dp, end = 8.dp, top = if (ready) 2.dp else 8.dp, bottom = if (ready) 2.dp else 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Mission · ticket ${ticket.optInt("number")} of ${mission.items("tickets").size} · ${TicketState.of(ticket.string("state")).label}", Modifier.weight(1f),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (ready) TextButton({ confirming = true }, enabled = model.state.string("missionAction") != "working") { Text("Accept", fontWeight = FontWeight.SemiBold) }
    }
    if (confirming) AlertDialog(onDismissRequest = { confirming = false }, title = { Text("Accept this ticket?") }, text = { Text("It counts as done for the mission.") },
        confirmButton = { TextButton({ confirming = false; model.command("acceptTicket", "missionId" to mission.string("id"), "number" to ticket.optInt("number")) }) { Text("Accept") } },
        dismissButton = { TextButton({ confirming = false }) { Text("Cancel") } })
}
