package com.nabocorp.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

@Composable internal fun NativeChoicePicker(title: String, description: String, selected: String, items: List<Pair<String, String>>, enabled: Boolean, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ListItem(headlineContent = { Text(title) }, supportingContent = { Text(items.firstOrNull { it.first == selected }?.second.orEmpty()) }, trailingContent = { Icon(Icons.Outlined.ExpandMore, null) },
            modifier = Modifier.semantics { contentDescription = description }.clickable(enabled = enabled, role = Role.Button, onClick = { open = true }))
        DropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            items.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, trailingIcon = { if (id == selected) Icon(Icons.Outlined.Check, null) }, onClick = { open = false; choose(id) }) }
        }
    }
}
