package com.nabocorp.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable internal fun SettingsContent(model: CompanionModel, enableNotifications: () -> Unit, setAppLockEnabled: (Boolean) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        SettingsSection {
            SettingsRow("Usage", Icons.Outlined.DataUsage, trailing = Icons.Outlined.ChevronRight) { model.sheet = "usage" }
        }
        SettingsSection("Messages", "Steer the current turn or queue the next. Hold Send to choose for one message.") {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Follow-up behavior", style = MaterialTheme.typography.bodyLarge)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("steer" to "Steer", "queue" to "Queue").forEachIndexed { index, (mode, label) ->
                        SegmentedButton(selected = model.composerPreferences.followUpBehavior == mode,
                            onClick = { model.composerPreferences.choose(mode) }, shape = SegmentedButtonDefaults.itemShape(index, 2)) { Text(label) }
                    }
                }
            }
        }
        SettingsSection("Security") { AppLockSettings(model.appLock, setAppLockEnabled) }
        SettingsSection("Notifications") {
            SettingsRow(model.push.status, Icons.Outlined.Notifications, trailing = Icons.Outlined.ChevronRight, action = enableNotifications)
            if (model.state.optBoolean("pushRegistrationFailed")) {
                SettingsDivider()
                SettingsRow("Retry notification registration", Icons.Outlined.Refresh) { model.push.refresh() }
            }
            if (model.push.status == "Notifications on") {
                SettingsDivider()
                SettingsRow("Turn off notifications", Icons.Outlined.NotificationsOff) { model.push.disable() }
            }
        }
        SettingsSection("Computer") {
            if (model.showConnectionLost) {
                ListItem(headlineContent = { Text("Connection lost") }, supportingContent = { Text("Reconnect to your computer to continue.") },
                    trailingContent = { TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect") } })
                SettingsDivider()
            }
            SettingsRow("Forget this computer", Icons.Outlined.DeleteOutline, destructive = true) { model.sheet = "forget" }
        }
        SettingsSection(model.product.string("name")) {
            ListItem(headlineContent = { Text("Version") }, trailingContent = {
                Text("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", color = MaterialTheme.colorScheme.onSurfaceVariant)
            })
            SettingsDivider()
            SettingsRow("Privacy Policy", Icons.Outlined.PrivacyTip, trailing = Icons.Outlined.OpenInNew) { openExternal(context, model.product.string("privacyUrl")) }
        }
    }
}

@Composable private fun SettingsSection(title: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) Text(title, Modifier.padding(horizontal = 16.dp).semantics { heading() },
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surface) { Column(content = content) }
        if (footer != null) Text(footer, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun SettingsRow(text: String, icon: ImageVector, trailing: ImageVector? = null, destructive: Boolean = false, action: () -> Unit) {
    val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    ListItem(headlineContent = { Text(text, color = color) }, leadingContent = { Icon(icon, null, tint = color) },
        trailingContent = trailing?.let { image -> { Icon(image, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) } },
        modifier = Modifier.clickable(role = Role.Button, onClick = action))
}

@Composable private fun SettingsDivider() { HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant) }
