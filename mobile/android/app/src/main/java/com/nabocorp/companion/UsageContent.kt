package com.nabocorp.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
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
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        when {
            connection != "connected" -> AppUnavailable("Laptop disconnected", Modifier.padding(top = 48.dp), Icons.Outlined.Laptop, "Connect to your laptop to see usage.") { AppUnavailableAction("Reconnect", reconnect) }
            loading -> Row(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                Text("Loading usage…", Modifier.padding(start = 12.dp), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            usage.string("status") == "failed" -> AppUnavailable("Couldn’t load usage", Modifier.padding(top = 48.dp), Icons.Outlined.WarningAmber, "Check your laptop connection and try again.") { AppUnavailableAction("Retry", refresh) }
            else -> {
                val providers = usage.items("providers").filter { provider -> provider.optBoolean("failed") || listOf("primary", "secondary").any { provider.obj("limits").optJSONObject(it) != null } }
                if (providers.isEmpty()) Text("No usage limits available.", Modifier.padding(horizontal = 32.dp, vertical = 24.dp), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                providers.forEach { provider ->
                    val backend = provider.string("backend")
                    ProviderHeader(backend, when (backend) { "codex" -> "Codex"; "claude" -> "Claude"; else -> backend.replaceFirstChar(Char::uppercase) })
                    AppSection(header = null, modifier = Modifier.padding(top = 0.dp)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                            if (provider.optBoolean("failed")) {
                                Text("Couldn’t load usage", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                TextButton(onClick = refresh, contentPadding = PaddingValues(0.dp)) { Text("Retry", fontSize = 17.sp) }
                            } else listOf("primary", "secondary").forEach { key -> provider.obj("limits").optJSONObject(key)?.let { UsageWindow(it, if (key == "primary") "Usage" else "Weekly", now) } }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun ProviderHeader(backend: String, name: String) {
    Row(Modifier.fillMaxWidth().padding(start = 32.dp, end = 16.dp, top = 20.dp).semantics { heading() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when (backend) {
            "codex" -> Icon(painterResource(R.drawable.provider_codex), null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurface)
            "claude" -> Image(painterResource(R.drawable.provider_claude), null, Modifier.size(24.dp))
        }
        Text(name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable private fun UsageWindow(window: JSONObject, fallback: String, now: Long) {
    val minutes = window.optInt("windowDurationMins")
    val label = when { minutes == 10080 -> "Weekly"; minutes <= 0 -> fallback; minutes % 60 == 0 -> "${minutes / 60}h"; else -> "${minutes}m" }
    val used = (window.opt("usedPercent") as? Number)?.toDouble()?.takeIf { it.isFinite() }
    val remaining = used?.let { ((100 - it) / 100).coerceIn(0.0, 1.0).toFloat() }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.Medium)
            Text(remaining?.let { "${(it * 100).roundToInt()}% left" } ?: "Unavailable", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (remaining != null) LinearProgressIndicator(progress = { remaining }, modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).clearAndSetSemantics {},
            color = MaterialTheme.colorScheme.primary, trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f), gapSize = 0.dp, drawStopIndicator = {})
        (window.opt("resetsAt") as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { reset ->
            val total = ceil(((reset * 1000 - now) / 60_000).coerceIn(0.0, Long.MAX_VALUE.toDouble() / 2)).toLong()
            val days = total / 1440; val hours = total % 1440 / 60; val mins = total % 60
            val countdown = when { days > 0 -> "${days}d ${hours}h"; hours > 0 -> "${hours}h ${mins}m"; else -> "${mins}m" }
            Text("Resets in $countdown", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
