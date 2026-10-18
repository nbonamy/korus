package com.nabocorp.companion

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A menu-style picker row: the title, the current value and the up-down mark. */
@Composable internal fun NativeChoicePicker(title: String, description: String, selected: String, items: List<Pair<String, String>>, enabled: Boolean, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        AppRow(title, Modifier.semantics { contentDescription = description }, enabled = enabled, onClick = { open = true }, trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.Text(items.firstOrNull { it.first == selected }?.second.orEmpty(), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Icon(Icons.Outlined.UnfoldMore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        })
        DropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            items.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, trailingIcon = { MenuCheck(id == selected) }, onClick = { open = false; choose(id) }) }
        }
    }
}
