package com.nabocorp.companion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable internal fun PermissionsContent(model: CompanionModel) {
    val permissions = model.state.obj("permissions")
    val presets = permissions.strings("presets")
    val modes = permissions.items("modes")
    Column {
        presets.forEach { preset ->
            val selected = preset == permissions.string("approvalPreset")
            PermissionChoice(preset.split('-').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }, selected, model.canChoosePermissions) { model.chooseApprovalPreset(preset) }
        }
        if (presets.isNotEmpty() && modes.isNotEmpty()) {
            HorizontalDivider()
            Text("Permission mode",Modifier.padding(horizontal=16.dp,vertical=12.dp),style=MaterialTheme.typography.titleSmall)
        }
        modes.forEach { mode ->
            PermissionChoice(mode.string("label"),mode.string("id") == permissions.string("permissionMode"),model.canChoosePermissions) { model.choosePermissionMode(mode.string("id")) }
        }
    }
}

@Composable private fun PermissionChoice(label: String, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    ListItem(headlineContent={ Text(label) },trailingContent={ RadioButton(selected,null,enabled=enabled) },
        modifier=Modifier.selectable(selected,enabled=enabled,role=Role.RadioButton,onClick=choose))
}
