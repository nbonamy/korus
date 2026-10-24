package com.nabocorp.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun SettingsContent(model: CompanionModel, enableNotifications: () -> Unit, setAppLockEnabled: (Boolean) -> Unit) {
    val context = LocalContext.current
    val laptops = model.state.items("laptops")
    val current = laptops.firstOrNull { it.string("id") == model.state.string("laptopId") }
    var forgetting by remember { mutableStateOf<org.json.JSONObject?>(null) }
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        SettingsHeader(model, current?.string("name"))
        AppSection("Account") {
            AppRow("Connections", icon = Icons.Outlined.Laptop, onClick = { model.sheet = "connections" }, trailing = { SettingValue(laptopSummary(laptops.map { it.string("name") })); Chevron() })
            AppDivider()
            AppRow("Usage and limits", icon = Icons.Outlined.Speed, onClick = { model.sheet = "usage" }, trailing = { Chevron() })
        }
        AppSection("Preferences", if (model.appLock.canProtect) null else appLockFooter(model.appLock)) {
            var menu by remember { mutableStateOf(false) }
            val modes = listOf(Triple("steer", "Steer", "Change what the agent is doing now"), Triple("queue", "Queue", "Wait for the agent to finish"))
            Box {
                AppRow("Follow-up", icon = Icons.Outlined.ChatBubbleOutline, onClick = { menu = true }, trailing = {
                    SettingValue(modes.first { it.first == model.composerPreferences.followUpBehavior }.second)
                    Icon(Icons.Outlined.UnfoldMore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                })
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, offset = DpOffset(16.dp, 0.dp)) {
                    modes.forEach { (mode, label, description) ->
                        DropdownMenuItem(text = { Column { Text(label); Text(description, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                            trailingIcon = { MenuCheck(model.composerPreferences.followUpBehavior == mode) },
                            onClick = { menu = false; model.composerPreferences.choose(mode) })
                    }
                }
            }
            AppDivider()
            AppRow("Notifications", icon = Icons.Outlined.NotificationsNone, onClick = enableNotifications, trailing = { SettingValue(notificationValue(model.push.status)); Chevron() })
            if (model.state.optBoolean("pushRegistrationFailed")) {
                AppDivider()
                AppRow("Retry notification setup", icon = Icons.Outlined.Refresh, onClick = { model.push.refresh() })
            }
            if (model.push.status == "Notifications on") {
                AppDivider()
                AppRow("Turn off notifications", icon = Icons.Outlined.NotificationsOff, onClick = { model.push.disable() })
            }
            AppDivider()
            AppLockSettings(model.appLock, setAppLockEnabled)
        }
        AppSection("About") {
            AppRow("Privacy Policy", icon = Icons.Outlined.PanTool, onClick = { openExternal(context, model.product.string("privacyUrl")) }, trailing = { Chevron() })
            AppDivider()
            AppRow("Version", icon = Icons.Outlined.Info, trailing = { SettingValue("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})") })
        }
        if (current != null) {
            AppSection {
                AppRow("Forget this laptop", icon = Icons.AutoMirrored.Outlined.Logout, iconTint = MaterialTheme.colorScheme.error, titleColor = MaterialTheme.colorScheme.error, onClick = { forgetting = current })
            }
        }
    }
    forgetting?.let { laptop ->
        ForgetLaptopDialog(laptop, onCancel = { forgetting = null }) {
            model.command("forget", "laptopId" to laptop.string("id"))
            forgetting = null
            model.dismissSheet()
        }
    }
}

/** The product's icon and where the link to the laptop stands, in place of a title. */
@Composable private fun SettingsHeader(model: CompanionModel, laptop: String?) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Image(painterResource(R.drawable.app_icon), null, Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)))
        Text(model.productName, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        model.state.connection.summary(laptop, model.showConnectionLost)?.let { Text(it, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** What the Connections row shows: the laptop's name, or how many there are. */
internal fun laptopSummary(names: List<String>) = when (names.size) { 0 -> "None"; 1 -> names[0]; else -> "${names.size} laptops" }

/** The Notifications row's value: the three standings by name, anything more specific as the platform words it. */
internal fun notificationValue(status: String) = when (status) {
    "Notifications on" -> "On"
    "Notifications are off" -> "Off"
    "Enable notifications" -> "Set up"
    else -> status.removePrefix("Notifications ").replaceFirstChar { it.uppercase() }
}

@Composable private fun SettingValue(text: String) {
    Text(text, fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The name to save for a laptop, or null when the person has typed nothing usable. */
internal fun cleanLaptopName(value: String): String? = value.trim().takeIf { it.isNotEmpty() && it.length <= 60 }

@Composable private fun RenameLaptopDialog(laptop: org.json.JSONObject, onCancel: () -> Unit, onSave: (String) -> Unit) {
    var name by remember { mutableStateOf(laptop.string("name")) }
    AlertDialog(onDismissRequest = onCancel, title = { Text("Rename laptop") },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }) },
        confirmButton = { TextButton(enabled = cleanLaptopName(name) != null, onClick = { cleanLaptopName(name)?.let(onSave) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } })
}

@Composable private fun ForgetLaptopDialog(laptop: org.json.JSONObject, onCancel: () -> Unit, onForget: () -> Unit) {
    AlertDialog(onDismissRequest = onCancel, title = { Text("Forget this laptop?") },
        text = { Text("${laptop.string("name")} will be removed from this phone. You will need a new pairing code to connect again.") },
        confirmButton = { TextButton(onClick = onForget) { Text("Forget Laptop", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } })
}

@Composable private fun Chevron() {
    Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
}

@Composable internal fun ConnectionsContent(model: CompanionModel) {
    val currentId = model.state.string("laptopId")
    var forgetting by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var renaming by remember { mutableStateOf<org.json.JSONObject?>(null) }
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
                            DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; renaming = laptop })
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
    renaming?.let { laptop ->
        RenameLaptopDialog(laptop, onCancel = { renaming = null }) { name ->
            model.command("renameLaptop", "laptopId" to laptop.string("id"), "name" to name)
            renaming = null
        }
    }
    forgetting?.let { laptop ->
        val id = laptop.string("id")
        ForgetLaptopDialog(laptop, onCancel = { forgetting = null }) {
            model.command("forget", "laptopId" to id)
            forgetting = null
            if (id == currentId) model.dismissSheet()
        }
    }
}
