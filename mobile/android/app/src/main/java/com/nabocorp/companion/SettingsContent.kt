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
        AppSection {
            AppRow("Connections", icon = Icons.Outlined.Laptop, onClick = { model.sheet = "connections" }, trailing = { Chevron() })
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

@Composable internal fun ConnectionsContent(model: CompanionModel) {
    val currentId = model.state.string("laptopId")
    var forgetting by remember { mutableStateOf<org.json.JSONObject?>(null) }
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        AppSection {
            val laptops = model.state.optJSONArray("laptops")
            for (index in 0 until (laptops?.length() ?: 0)) {
                val laptop = laptops!!.getJSONObject(index)
                val id = laptop.string("id")
                val name = laptop.string("name")
                var menu by remember(id) { mutableStateOf(false) }
                if (index > 0) AppDivider()
                AppRow(name, icon = Icons.Outlined.Laptop, onClick = {
                    if (id != currentId) model.command("connect", "laptopId" to id)
                    else if (!model.state.connection.isConnected) model.command("reconnect")
                    model.dismissSheet()
                }, trailing = {
                    if (id == currentId) {
                        Text("Current", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(Icons.Outlined.Check, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, "Manage $name") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Forget connection", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; forgetting = laptop })
                        }
                    }
                })
            }
            if (model.showConnectionLost) {
                AppDivider()
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Connection lost", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect") }
                }
            }
        }
        AppSection {
            AppRow("Add connection", icon = Icons.Outlined.Add, onClick = { model.command("chooseConnection"); model.dismissSheet() })
        }
    }
    forgetting?.let { laptop ->
        val id = laptop.string("id")
        AlertDialog(onDismissRequest = { forgetting = null }, title = { Text("Forget this laptop?") },
            text = { Text("${laptop.string("name")} will be removed from this phone. You will need a new pairing code to connect again.") },
            confirmButton = { TextButton(onClick = {
                model.command("forget", "laptopId" to id)
                forgetting = null
                if (id == currentId) model.dismissSheet()
            }) { Text("Forget Laptop", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { forgetting = null }) { Text("Cancel") } })
    }
}
