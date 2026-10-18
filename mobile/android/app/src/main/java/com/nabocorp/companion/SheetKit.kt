package com.nabocorp.companion

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The grouped-list vocabulary shared by every secondary screen: one canvas, white cards, a centered title. */

/** A screen frame: centered inline title, optional leading/trailing pills, scrolling content and an optional pinned footer. */
@Composable internal fun AppSheetFrame(title: String, modifier: Modifier = Modifier, leading: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null, scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxSize().background(CompanionColors.sheetBackground).safeDrawingPadding()) {
        AppSheetHeader(title, leading, trailing)
        Column(Modifier.weight(1f).fillMaxWidth().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier), content = content)
        if (footer != null) AppSheetFooter(footer)
    }
}

/** The centered inline title with an optional pill on each side. */
@Composable internal fun AppSheetHeader(title: String, leading: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        if (title.isNotBlank()) Text(title, Modifier.padding(horizontal = 88.dp).semantics { heading() }, maxLines = 1, overflow = TextOverflow.Ellipsis,
            fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurface)
        if (leading != null) Box(Modifier.align(Alignment.CenterStart)) { leading() }
        if (trailing != null) Box(Modifier.align(Alignment.CenterEnd)) { trailing() }
    }
}

/** The bar below a form: the same canvas, a hairline above it, one prominent action. */
@Composable internal fun AppSheetFooter(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(CompanionColors.sheetBackground)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Box(Modifier.fillMaxWidth().padding(16.dp)) { content() }
    }
}

/** A text action in the bar: a quiet capsule, like the glass buttons of the system bar. */
@Composable internal fun AppBarPill(text: String, enabled: Boolean = true, description: String? = null, icon: ImageVector? = null, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, shape = CircleShape, color = MaterialTheme.colorScheme.surface, border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant), shadowElevation = 2.dp,
        modifier = Modifier.heightIn(min = 48.dp).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        Row(Modifier.padding(start = if (icon != null) 12.dp else 20.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurface.let { if (enabled) it else it.copy(alpha = 0.38f) })
            Text(text, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface.let { if (enabled) it else it.copy(alpha = 0.38f) })
        }
    }
}

/** A circular icon action in the bar. */
@Composable internal fun AppBarIcon(icon: ImageVector, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, shape = CircleShape, color = MaterialTheme.colorScheme.surface, border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant), shadowElevation = 2.dp,
        modifier = Modifier.size(48.dp)) {
        Box(contentAlignment = Alignment.Center) { Icon(icon, description, tint = MaterialTheme.colorScheme.onSurface.let { if (enabled) it else it.copy(alpha = 0.38f) }) }
    }
}

/** A white card on the grouped canvas. */
@Composable internal fun AppSection(header: String? = null, footer: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (header != null) Text(header, Modifier.padding(horizontal = 16.dp).semantics { heading() }, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.surface) { Column(content = content) }
        if (footer != null) Text(footer, Modifier.padding(horizontal = 16.dp), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable internal fun AppDivider(inset: Boolean = true) {
    HorizontalDivider(Modifier.padding(start = if (inset) 16.dp else 0.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

/** A 44-point row: optional leading icon, a title, and optional trailing content. */
@Composable internal fun AppRow(title: String, modifier: Modifier = Modifier, icon: ImageVector? = null, iconTint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.primary,
    titleColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface, enabled: Boolean = true, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val alpha = if (enabled) 1f else 0.38f
    Row(modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick) else Modifier)
        .heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        if (icon != null) Icon(icon, null, Modifier.size(24.dp), tint = iconTint.copy(alpha = iconTint.alpha * alpha))
        Text(title, Modifier.weight(1f), fontSize = 17.sp, color = titleColor.copy(alpha = titleColor.alpha * alpha))
        trailing?.invoke()
    }
}

/** A choice with a title, a description and a selection mark (iOS radio-circle rows). */
@Composable internal fun AppChoiceRow(title: String, description: String, icon: ImageVector?, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick).semantics { this.selected = selected }
        .padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val alpha = if (enabled) 1f else 0.45f
        if (icon != null) Icon(icon, null, Modifier.padding(top = 2.dp).size(24.dp), tint = MaterialTheme.colorScheme.onSurface.copy(alpha = alpha))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = alpha))
            if (description.isNotBlank()) Text(description, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha))
        }
        Icon(if (selected) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, Modifier.size(24.dp),
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha))
    }
}

/** The prominent capsule action of a form. */
@Composable internal fun AppProminentButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth().heightIn(min = 50.dp), shape = CircleShape) { Text(text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
}

/** A message with an optional symbol, description and actions, centered in the space it replaces. */
@Composable internal fun AppUnavailable(title: String, modifier: Modifier = Modifier, icon: ImageVector? = null, description: String? = null, actions: (@Composable ColumnScope.() -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
        if (icon != null) Icon(icon, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        if (description != null) Text(description, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (actions != null) { Spacer(Modifier.height(4.dp)); actions() }
    }
}

/** The bordered action beneath an unavailable-content message. */
@Composable internal fun AppUnavailableAction(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    Button(onClick = onClick, enabled = enabled, shape = CircleShape, contentPadding = PaddingValues(horizontal = 20.dp), modifier = Modifier.heightIn(min = 44.dp),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f), contentColor = MaterialTheme.colorScheme.primary)) { Text(text, fontSize = 17.sp, fontWeight = FontWeight.Medium) }
}

/** The tinted square, title and wait indicator used while an operation replaces a form. */
@Composable internal fun AppProgress(title: String, icon: ImageVector, message: String, modifier: Modifier = Modifier, subject: String? = null, branch: String? = null) {
    Column(modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically)) {
        Box(Modifier.size(80.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(22.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.onPrimary)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            if (!subject.isNullOrBlank()) Text(subject, fontSize = 17.sp, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (!branch.isNullOrBlank()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.AccountTree, null, Modifier.size(16.dp)); Text(branch, fontSize = 15.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
            Text(message, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        CircularProgressIndicator(Modifier.size(36.dp).semantics { contentDescription = title })
    }
}

/** A checkmark shown beside the chosen value of a menu. */
@Composable internal fun MenuCheck(visible: Boolean) { if (visible) Icon(Icons.Outlined.Check, null) }

/** A plain single-line field that lives inside a card row. */
@Composable internal fun AppTextField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, enabled: Boolean = true,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default, leading: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        leading?.invoke()
        androidx.compose.foundation.text.BasicTextField(value = value, onValueChange = onValueChange, enabled = enabled, singleLine = true, modifier = modifier.weight(1f),
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurface), keyboardOptions = keyboardOptions,
            cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { field -> Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                field()
            } })
    }
}
