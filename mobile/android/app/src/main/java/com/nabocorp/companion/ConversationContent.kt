package com.nabocorp.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable internal fun ConversationContent(model: CompanionModel, modifier: Modifier = Modifier) {
    val presentation = model.conversationPresentation
    val connected = model.state.connection.isConnected
    Column(modifier) {
        if (presentation.hasTranscript && model.showConnectionLost) Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 2.dp),verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.WifiOff, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Connection lost",Modifier.weight(1f),fontSize = 15.sp,color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect", fontSize = 15.sp) }
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            WebContent(model.transcript,Modifier.fillMaxSize(),interactive = !presentation.loading && !presentation.failed && (connected || presentation.hasTranscript))
            when {
                model.showConnectionLost && !presentation.hasTranscript -> ConnectionLostContent { model.command("reconnect") }
                model.state.string("agentId").isBlank() -> ConversationNotice("Your workspace is ready","Open the menu to choose an agent or start a quick chat.")
                presentation.failed -> ConversationNotice("Couldn’t load this conversation","Try again to reconnect to this conversation.", icon = Icons.Outlined.ErrorOutline) {
                    AppUnavailableAction("Retry", model::retryConversation, connected)
                }
                presentation.loading -> ConversationProgress("Loading conversation…",Modifier.testTag("conversation-loading"))
                !connected && !presentation.hasTranscript -> ConversationProgress("Connecting to your laptop…")
            }
        }
    }
}

@Composable internal fun StartupFailure(retry: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Couldn’t restore your connection.", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = retry) { Text("Retry", fontSize = 17.sp) }
        }
    }
}
@Composable internal fun StartupProgress(paired: Boolean, name: String) {
    BrandedEntry(name) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            Text(if (paired) "Connecting to your laptop…" else "Opening your workspace…", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable internal fun ConnectionLostContent(reconnect: () -> Unit) {
    AppUnavailable("Connection lost", Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).testTag("connection-lost-fullscreen"), Icons.Outlined.WifiOff) {
        AppUnavailableAction("Reconnect", reconnect)
    }
}

/** Keeps branding fixed while the entry action changes: the mark, the product name, and one footer. */
@Composable internal fun BrandedEntry(name: String, footer: @Composable () -> Unit) {
    val center = MaterialTheme.colorScheme.surfaceContainerLow
    val edge = MaterialTheme.colorScheme.background
    Column(Modifier.fillMaxSize().drawBehind {
        drawRect(Brush.radialGradient(listOf(center, edge), center = Offset(size.width * 0.5f, size.height * 0.42f), radius = 360.dp.toPx()))
    }.safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        Image(painterResource(R.drawable.app_icon), null, Modifier.size(112.dp).shadow(24.dp, RoundedCornerShape(28.dp), ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.12f)).clip(RoundedCornerShape(28.dp)))
        Spacer(Modifier.height(24.dp))
        Text(name, fontSize = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.8).sp)
        Box(Modifier.padding(top = 44.dp).heightIn(min = 44.dp), contentAlignment = Alignment.Center) { footer() }
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(64.dp))
    }
}

@Composable private fun ConversationProgress(text: String, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxSize(),color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp),verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator();Text(text,fontSize = 15.sp,color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun ConversationNotice(title: String, description: String, modifier: Modifier = Modifier, icon: ImageVector? = null, action: (@Composable ColumnScope.() -> Unit)? = null) {
    AppUnavailable(title, modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), icon, description, action)
}
