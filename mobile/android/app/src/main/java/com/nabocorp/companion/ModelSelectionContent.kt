package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable internal fun ModelSelectionContent(model: CompanionModel) {
    val state = model.state
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        state.items("models").forEach { option ->
            ListItem(headlineContent = { Text(option.string("name")) }, trailingContent = { RadioButton(option.string("id") == state.obj("composer").string("modelId"), null, enabled = model.canChooseModel) },
                modifier = Modifier.selectable(option.string("id") == state.obj("composer").string("modelId"), enabled = model.canChooseModel, role = Role.RadioButton) { model.chooseModel(option.string("id")) })
        }
        val efforts = model.selectedModel?.strings("efforts").orEmpty()
        if (efforts.isNotEmpty()) {
            HorizontalDivider()
            Text("Reasoning", Modifier.padding(horizontal = 16.dp, vertical = 12.dp), style = MaterialTheme.typography.titleSmall)
            efforts.forEach { effort ->
                val selected = effort == state.obj("composer").string("effort")
                ListItem(headlineContent = { Text(effort.replaceFirstChar(Char::uppercase)) }, trailingContent = { RadioButton(selected, null, enabled = model.canChooseModel) },
                    modifier = Modifier.selectable(selected, enabled = model.canChooseModel, role = Role.RadioButton) { model.chooseReasoningEffort(effort) })
            }
        }
    }
}
