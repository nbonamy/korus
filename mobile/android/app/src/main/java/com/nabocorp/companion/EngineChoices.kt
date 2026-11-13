package com.nabocorp.companion

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private fun engineName(provider: String) = when (provider) { "codex" -> "Codex"; "claude" -> "Claude"; else -> provider.replaceFirstChar(Char::uppercase) }

private fun engineMark(provider: String): Int? = when (provider) {
    "codex" -> R.drawable.provider_codex; "claude" -> R.drawable.provider_claude
    "cursor" -> R.drawable.provider_cursor; "antigravity" -> R.drawable.provider_antigravity; else -> null
}

/** Above the composer of an empty chat: the engines this laptop can run, the chosen one checked. It leaves with the first prompt. */
@Composable internal fun EngineChoiceList(choices: List<String>, selected: String, modifier: Modifier = Modifier, onChoose: (String) -> Unit) {
    Surface(modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp).fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), shadowElevation = 6.dp) {
        Column(Modifier.padding(6.dp)) {
            choices.forEach { provider ->
                val chosen = provider == selected
                val tint = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                Row(Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp))
                    .then(if (chosen) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) else Modifier)
                    .selectable(chosen, role = Role.RadioButton) { onChoose(provider) }.padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    engineMark(provider)?.let { Icon(painterResource(it), null, Modifier.size(20.dp), tint = tint) } ?: Spacer(Modifier.size(20.dp))
                    Text(engineName(provider), Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                    if (chosen) Icon(Icons.Filled.Check, null, Modifier.size(20.dp), tint = tint)
                }
            }
        }
    }
}
