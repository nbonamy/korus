package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Quota data stays owned by the shared engine; this native view formats and refreshes it. */
@Composable internal fun UsageContent(usage: JSONObject, connection: String, refresh: () -> Unit, reconnect: () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(connection) { if (connection == "connected") refresh() }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    val loading = usage.string("status") in listOf("", "idle", "loading")
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = refresh, enabled = connection == "connected" && !loading) { Icon(Icons.Outlined.Refresh, "Refresh usage") }
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 480.dp).padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            when {
                connection != "connected" -> item {
                    UsageNotice("Computer disconnected", "Connect to your computer to see usage.", "Reconnect", reconnect)
                }
                loading -> item {
                    Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        Text("Loading usage…", Modifier.padding(start = 12.dp))
                    }
                }
                usage.string("status") == "failed" -> item {
                    UsageNotice("Couldn’t load usage", "Check your computer connection and try again.", "Retry", refresh)
                }
                else -> {
                    val providers = usage.items("providers").filter { provider -> provider.optBoolean("failed") || listOf("primary", "secondary").any { provider.obj("limits").optJSONObject(it) != null } }
                    if (providers.isEmpty()) item { Text("No usage limits available.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    providers.forEach { provider -> item(key = provider.string("backend")) {
                        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            Text(when (provider.string("backend")) { "codex" -> "Codex"; "claude" -> "Claude"; else -> provider.string("backend").replaceFirstChar(Char::uppercase) }, style = MaterialTheme.typography.titleMedium)
                            if (provider.optBoolean("failed")) UsageNotice("Couldn’t load usage", null, "Retry", refresh)
                            else listOf("primary", "secondary").forEach { key -> provider.obj("limits").optJSONObject(key)?.let { UsageWindow(it, if (key == "primary") "Usage" else "Weekly", now) } }
                        }
                    } }
                }
            }
        }
    }
}

@Composable private fun UsageNotice(title: String, detail: String?, action: String, perform: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        if (detail != null) Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = perform) { Text(action) }
    }
}

@Composable private fun UsageWindow(window: JSONObject, fallback: String, now: Long) {
    val minutes = window.optInt("windowDurationMins")
    val label = when { minutes == 10080 -> "Weekly"; minutes <= 0 -> fallback; minutes % 60 == 0 -> "${minutes / 60}h"; else -> "${minutes}m" }
    val used = (window.opt("usedPercent") as? Number)?.toDouble()?.takeIf { it.isFinite() }
    val remaining = used?.let { ((100 - it) / 100).coerceIn(0.0, 1.0).toFloat() }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f))
            Text(remaining?.let { "${(it * 100).roundToInt()}% left" } ?: "Unavailable", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (remaining != null) LinearProgressIndicator(progress = { remaining }, modifier = Modifier.fillMaxWidth())
        (window.opt("resetsAt") as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { reset ->
            val total = ceil(((reset * 1000 - now) / 60_000).coerceIn(0.0, Long.MAX_VALUE.toDouble() / 2)).toLong()
            val days = total / 1440; val hours = total % 1440 / 60; val mins = total % 60
            val countdown = when { days > 0 -> "${days}d ${hours}h"; hours > 0 -> "${hours}h ${mins}m"; else -> "${mins}m" }
            Text("Resets in $countdown", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
