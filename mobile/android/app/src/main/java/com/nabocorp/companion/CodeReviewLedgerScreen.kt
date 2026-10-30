package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable internal fun CodeReviewLedgerScreen(model: CompanionModel, details: JSONObject, session: JSONObject) {
    val state = model.state
    val review = state.obj("review")
    val activeRound = session.string("activeRoundId")
    var roundId by remember(session.string("id"), activeRound) { mutableStateOf(activeRound) }
    var confirmation by remember { mutableStateOf<String?>(null) }
    var confirmedCommand by remember { mutableStateOf<JSONObject?>(null) }
    var options by remember { mutableStateOf(false) }
    val round = session.items("rounds").firstOrNull { it.string("id") == roundId } ?: session.items("rounds").lastOrNull()
    val status = session.string("status")
    val automatic = session.obj("automation").string("state") == "running"
    val available = state.connection.isConnected && review.string("action") !in listOf("working", "unknown", "failed")
    val idle = available && !session.optBoolean("busy") && !automatic
    val canDecide = idle && status == "ready" && roundId == activeRound
    val selected = session.items("rounds").firstOrNull { it.string("id") == activeRound }?.items("findings")
        ?.count { it.obj("decision").string("state") != "rejected" && it.obj("remediation").string("state") != "fixed" } ?: 0
    fun send(action: String, finding: String? = null, selected: Boolean? = null, question: String? = null) {
        if (!available) return
        val input = json("sessionId" to session.string("id"), "roundId" to activeRound, "updatedAt" to session.string("updatedAt"), "action" to action)
        finding?.let { input.put("findingId", it) }; selected?.let { input.put("selected", it) }; question?.let { input.put("question", it) }
        model.command("reviewAction", "target" to details.obj("target"), "input" to input)
    }
    fun confirm(action: String) {
        confirmedCommand = json("target" to details.obj("target"), "input" to json("sessionId" to session.string("id"), "roundId" to activeRound, "updatedAt" to session.string("updatedAt"), "action" to action))
        confirmation = action
    }
    LaunchedEffect(session.string("id"), state.connection) {
        while (true) {
            delay(3000)
            if (model.foreground && model.state.connection.isConnected && model.state.obj("review").string("action") !in listOf("working", "unknown")) model.command("loadReviewDetails")
        }
    }
    BackHandler { model.dismissReview() }
    AppSheetFrame("Review Changes", leading = { AppBarIcon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Back to conversation", onClick = model::dismissReview) },
        trailing = {
            Box {
                IconButton(onClick = { options = true }) { Icon(Icons.Outlined.MoreVert, "Review options") }
                DropdownMenu(options, { options = false }) {
                    DropdownMenuItem(text = { Text("Refresh") }, onClick = { options = false; model.command("loadReviewDetails") })
                    DropdownMenuItem(text = { Text("Discard review") }, enabled = available && !automatic, onClick = { options = false; confirm("discard") })
                }
            }
        }, scroll = false, footer = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (review.string("action") in listOf("unknown", "failed")) {
                    Text("Couldn’t confirm the latest review status.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { model.command("loadReviewDetails") }) { Text("Refresh status") }
                }
                if (review.string("action") == "working") LinearProgressIndicator(Modifier.fillMaxWidth())
                when {
                    automatic -> OutlinedButton(onClick = { confirm("manual") }, enabled = available, modifier = Modifier.fillMaxWidth()) { Text("Switch to manual") }
                    status == "ready" -> AppProminentButton(if (selected > 0) "Fix selected" else "Complete round", canDecide) { confirm("submit") }
                    status in listOf("readyToFinish", "failed") -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (status == "readyToFinish") Button(onClick = { confirm("finish") }, enabled = idle, modifier = Modifier.weight(1f)) { Text("Finish review") }
                        OutlinedButton(onClick = { confirm("again") }, enabled = idle, modifier = Modifier.weight(1f)) { Text(if (status == "failed") "Retry review" else "Review again") }
                    }
                }
            }
        }) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(when(status) { "reviewing" -> "Review in progress"; "ready" -> "Choose findings to fix"; "fixing" -> "Fixing findings"; "readyToFinish" -> "Ready to finish"; "failed" -> "Review stopped"; else -> "Review complete" }, style = MaterialTheme.typography.titleMedium)
                    val count = round?.items("findings")?.size ?: 0
                    Text("Round ${round?.optInt("number")} · $count ${if (count == 1) "finding" else "findings"}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (session.optBoolean("busy") || status in listOf("reviewing", "fixing")) CircularProgressIndicator(Modifier.size(24.dp))
            }
            if (session.items("rounds").size > 1) NativeChoicePicker("Review round", "Review round", roundId, session.items("rounds").map { it.string("id") to "Round ${it.optInt("number")}" }, true) { roundId = it }
            session.obj("automation").string("reason").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            TextButton(onClick = { model.selectAgent(session.string("reviewerAgentId")) }) { Text("Open reviewer conversation") }
            round?.string("error")?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            round?.string("summary")?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (round?.items("findings").isNullOrEmpty()) Text(if (status == "reviewing") "Findings will appear as the review progresses." else "No findings in this round.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            listOf("p0", "p1", "p2", "p3").forEach { priority ->
                val findings = round?.items("findings")?.filter { it.string("priority") == priority }.orEmpty()
                if (findings.isNotEmpty()) AppSection("${when(priority) { "p0" -> "Critical priority"; "p1" -> "High priority"; "p2" -> "Medium priority"; else -> "Low priority" }} · ${findings.size}") {
                    findings.forEachIndexed { index, finding ->
                        ReviewLedgerFinding(finding, canDecide, { send("decide", finding.string("id"), it) }, { send("discuss", finding.string("id"), question = it) })
                        if (index != findings.lastIndex) AppDivider()
                    }
                }
            }
        }
    }
    confirmation?.let { action ->
        AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(when(action) { "submit" -> "Submit this round?"; "again" -> "Start another review round?"; "finish" -> "Finish this review?"; "manual" -> "Switch to manual review?"; else -> "Discard this review?" }) },
            text = { Text(when(action) {
                "submit" -> "Selected findings will be fixed. Unselected findings will be skipped."
                "again" -> "The reviewer will inspect the changes again, keeping earlier findings and decisions."
                "finish" -> "Save the review report and close the review."
                "manual" -> "The current operation can finish. You will choose subsequent fixes and rounds."
                else -> "Close the review without saving a report. Code changes will be kept."
            }) }, confirmButton = { TextButton(onClick = { if (available) confirmedCommand?.let { model.command("reviewAction", "target" to it.obj("target"), "input" to it.obj("input")) }; confirmation = null }, enabled = available) { Text("Confirm") } },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancel") } })
    }
}

@Composable private fun ReviewLedgerFinding(finding: JSONObject, canDecide: Boolean, select: (Boolean) -> Unit, discuss: (String) -> Unit) {
    var expanded by remember(finding.string("id")) { mutableStateOf(false) }
    var question by remember(finding.string("id")) { mutableStateOf("") }
    val selected = finding.obj("decision").string("state") != "rejected"
    val remediation = finding.obj("remediation")
    val state = remediation.string("state")
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Checkbox(selected, onCheckedChange = select, enabled = canDecide && state != "fixed",
                modifier = Modifier.semantics { contentDescription = "Select ${finding.string("title")}" })
            Column(Modifier.weight(1f).clickable { expanded = !expanded }.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(finding.string("title"), style = MaterialTheme.typography.bodyLarge)
                finding.optJSONObject("location")?.let { location -> Text(location.string("file") + if (location.has("line")) ":${location.optInt("line")}" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(when(state) { "fixed" -> "Fixed"; "fixing" -> "Fixing"; "pending" -> "Queued"; "skipped" -> "Skipped"; else -> if (selected) "Selected" else "Skipped" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (expanded) {
            androidx.compose.foundation.text.selection.SelectionContainer { Text(finding.string("body"), style = MaterialTheme.typography.bodyMedium) }
            remediation.string("evidence").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            finding.obj("decision").string("reason").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            finding.items("discussion").forEach { message ->
                Text(if (message.string("author") == "user") "You" else "Reviewer", style = MaterialTheme.typography.labelSmall)
                Text(message.string("body"), style = MaterialTheme.typography.bodyMedium)
            }
            if (canDecide) {
                OutlinedTextField(question, { question = it }, label = { Text("Ask about this finding") }, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { discuss(question.trim()) }, enabled = question.isNotBlank()) { Text("Ask reviewer") }
            }
        }
    }
}
