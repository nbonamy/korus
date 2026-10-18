package com.nabocorp.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun SettingsContent(model: CompanionModel, enableNotifications: () -> Unit, setAppLockEnabled: (Boolean) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        AppSection { AppRow("Usage", icon = Icons.Outlined.Speed, onClick = { model.sheet = "usage" }, trailing = { Chevron() }) }
        AppSection("Messages", "Steer the current turn or queue the next. Hold Send to override.") {
            var menu by remember { mutableStateOf(false) }
            val modes = listOf("steer" to "Steer", "queue" to "Queue")
            Box {
                AppRow("Follow-up behavior", onClick = { menu = true }, trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(modes.first { it.first == model.composerPreferences.followUpBehavior }.second, fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(Icons.Outlined.UnfoldMore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                })
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, offset = DpOffset(16.dp, 0.dp)) {
                    modes.forEach { (mode, label) ->
                        DropdownMenuItem(text = { Text(label) }, trailingIcon = { MenuCheck(model.composerPreferences.followUpBehavior == mode) },
                            onClick = { menu = false; model.composerPreferences.choose(mode) })
                    }
                }
            }
        }
        AppSection("Security", appLockFooter(model.appLock)) { AppLockSettings(model.appLock, setAppLockEnabled) }
        AppSection("Notifications") {
            AppRow(model.push.status, icon = Icons.Outlined.NotificationsActive, onClick = enableNotifications, trailing = { Chevron() })
            if (model.state.optBoolean("pushRegistrationFailed")) {
                AppDivider()
                AppRow("Retry notification setup", icon = Icons.Outlined.Refresh, onClick = { model.push.refresh() })
            }
            if (model.push.status == "Notifications on") {
                AppDivider()
                AppRow("Turn off notifications", icon = Icons.Outlined.NotificationsOff, onClick = { model.push.disable() })
            }
        }
        AppSection("Laptop") {
            if (model.showConnectionLost) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.WifiOff, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Connection lost", Modifier.weight(1f), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect", fontSize = 15.sp) }
                }
                AppDivider()
            }
            AppRow("Forget this laptop", icon = Icons.Outlined.DeleteOutline, iconTint = MaterialTheme.colorScheme.error, titleColor = MaterialTheme.colorScheme.error, onClick = { model.sheet = "forget" })
        }
        AppSection(model.productName) {
            AppRow("Version", trailing = { Text("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) })
            AppDivider()
            AppRow("Privacy Policy", icon = Icons.Outlined.PanTool, titleColor = MaterialTheme.colorScheme.primary, onClick = { openExternal(context, model.product.string("privacyUrl")) })
        }
    }
}

@Composable private fun Chevron() {
    Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
}
