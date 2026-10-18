package com.nabocorp.companion

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable internal fun ConversationContent(model: CompanionModel, modifier: Modifier = Modifier) {
    val presentation = model.conversationPresentation
    val connected = model.state.string("connection") == "connected"
    Column(modifier) {
        if (presentation.hasTranscript && model.showConnectionLost) Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),verticalAlignment = Alignment.CenterVertically) {
                Text("Connection lost",Modifier.weight(1f),style = MaterialTheme.typography.bodySmall,color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect") }
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            WebContent(model.transcript,Modifier.fillMaxSize(),interactive = !presentation.loading && !presentation.failed && (connected || presentation.hasTranscript))
            when {
                model.showConnectionLost && !presentation.hasTranscript -> ConnectionLostContent { model.command("reconnect") }
                model.state.string("agentId").isBlank() -> ConversationNotice("Your workspace is ready","Open the menu to choose an agent or start a quick chat.") {}
                presentation.failed -> ConversationNotice("Couldn’t load this conversation","Try again to reconnect to this conversation.") {
                    TextButton(onClick = model::retryConversation,enabled = connected) { Text("Retry") }
                }
                presentation.loading -> ConversationProgress("Loading conversation…",Modifier.testTag("conversation-loading"))
                !connected && !presentation.hasTranscript -> ConversationProgress("Connecting to your computer…")
            }
        }
    }
}

@Composable internal fun StartupFailure(retry: () -> Unit) {
    ConversationNotice("Couldn’t restore your connection","Try again. If this continues, update Android System WebView.") {
        TextButton(onClick = retry) { Text("Retry") }
    }
}
@Composable internal fun StartupProgress(paired: Boolean, name: String) {
    ConversationProgress(if (paired) "Connecting to your computer…" else "Starting $name…")
}
@Composable internal fun ConnectionLostContent(reconnect: () -> Unit) {
    ConversationNotice("Connection lost","Reconnect to your computer to continue.",Modifier.testTag("connection-lost-fullscreen")) {
        TextButton(onClick = reconnect) { Text("Reconnect") }
    }
}
@Composable private fun ConversationProgress(text: String, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxSize(),color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp),verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator();Text(text,color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun ConversationNotice(title: String, description: String, modifier: Modifier = Modifier, action: @Composable () -> Unit) {
    Surface(modifier.fillMaxSize(),color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp),verticalArrangement = Arrangement.spacedBy(12.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title,style = MaterialTheme.typography.titleLarge)
            Text(description,color = MaterialTheme.colorScheme.onSurfaceVariant)
            action()
        }
    }
}
