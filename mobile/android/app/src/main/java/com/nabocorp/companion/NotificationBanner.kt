package com.nabocorp.companion

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.util.Locale

private const val BANNER_TIMEOUT_MS = 6_000L

/** Native presentation only: expiry and gestures dismiss the inbox item, never mark work read. */
@Composable internal fun NotificationBannerHost(inbox: AttentionNotifications, modifier: Modifier = Modifier) {
    AnimatedContent(targetState = inbox.current, modifier = modifier.widthIn(max = 600.dp).fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        contentKey = { it?.id }, label = "Agent notification", transitionSpec = {
            (fadeIn(tween(180)) + slideInVertically(tween(220)) { -it / 2 })
                .togetherWith(fadeOut(tween(150)) + slideOutVertically(tween(180)) { -it / 2 })
                .using(SizeTransform(clip = false))
        }) { notification ->
        if (notification != null) NotificationBanner(notification,
            onOpen = { inbox.tapped(notification.source) }, onDismiss = { inbox.dismiss(notification.id) })
    }
}

@Composable private fun NotificationBanner(notification: AttentionNotification, onOpen: () -> Unit, onDismiss: () -> Unit) {
    val dismissCurrent by rememberUpdatedState(onDismiss)
    val timeout = LocalAccessibilityManager.current?.calculateRecommendedTimeoutMillis(BANNER_TIMEOUT_MS,
        containsIcons = true, containsText = true, containsControls = true) ?: BANNER_TIMEOUT_MS
    LaunchedEffect(notification.id, timeout) {
        if (timeout != Long.MAX_VALUE) { delay(timeout); dismissCurrent() }
    }
    val threshold = with(LocalDensity.current) { 20.dp.toPx() }
    val name = notification.name.ifBlank { "Agent" }
    val initials = remember(name) {
        name.trim().split(Regex("\\s+")).filter(String::isNotEmpty).take(2)
            .joinToString("") { it.substring(0, it.offsetByCodePoints(0, 1)) }.uppercase(Locale.getDefault()).ifBlank { "?" }
    }
    val tint = when (notification.kind) { "completed" -> CompanionColors.addedLines; "approval" -> CompanionColors.worktree; else -> MaterialTheme.colorScheme.primary }
    val symbol = when (notification.kind) { "completed" -> Icons.Outlined.Check; "approval" -> Icons.Outlined.PanTool; else -> Icons.AutoMirrored.Outlined.HelpOutline }
    Surface(shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 6.dp,
        modifier = Modifier.fillMaxWidth().testTag("attention-banner")
            .pointerInput(notification.id, threshold) {
                var distance = 0f
                detectVerticalDragGestures(onDragStart = { distance = 0f }, onDragCancel = { distance = 0f },
                    onVerticalDrag = { change, amount -> change.consume(); distance += amount },
                    onDragEnd = { if (distance < -threshold) dismissCurrent() })
            }.semantics { liveRegion = LiveRegionMode.Polite; dismiss { dismissCurrent(); true } }) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = "Open conversation", onClick = onOpen)
                .semantics { contentDescription = "$name, ${notification.message}" }.heightIn(min = 72.dp).padding(start = 16.dp, end = 8.dp, top = 15.dp, bottom = 15.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                Box(Modifier.size(42.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
                    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), CircleShape), contentAlignment = Alignment.Center) {
                        Text(initials, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onPrimaryContainer, maxLines = 1)
                    }
                    Surface(Modifier.align(Alignment.BottomEnd).offset(x = 3.dp, y = 2.dp).size(19.dp), shape = CircleShape, color = tint,
                        border = BorderStroke(2.dp, MaterialTheme.colorScheme.background)) {
                        Box(contentAlignment = Alignment.Center) { Icon(symbol, null, Modifier.size(10.dp), tint = MaterialTheme.colorScheme.onPrimary) }
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(notification.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(width = 48.dp, height = 52.dp).semantics { contentDescription = "Dismiss notification" }) {
                Icon(Icons.Outlined.Close, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
