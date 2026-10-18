package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Remove every private presentation, including native dialog windows, while retaining model-owned navigation and drafts. */
@Composable internal fun AppLockHost(lock: AppLock, name: String, unlock: () -> Unit, content: @Composable () -> Unit) {
    if (lock.isLocked) {
        BackHandler {}
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Image(painterResource(R.drawable.app_icon), null, Modifier.size(76.dp))
                Spacer(Modifier.height(24.dp))
                Text(name, style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.height(12.dp))
                Text("Unlock to see your conversations.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(24.dp))
                Button(onClick = unlock, enabled = !lock.isAuthenticating) { Text("Unlock") }
            }
        }
    } else content()
}

@Composable internal fun AppLockSettings(lock: AppLock, setEnabled: (Boolean) -> Unit) {
    ListItem(headlineContent = { Text("Lock with device authentication") }, supportingContent = {
        Text(if (lock.canProtect) "Use your fingerprint, face or device PIN when the app opens and after five minutes away."
            else "Set a screen lock on this device to lock the app.")
    }, trailingContent = {
        Switch(checked = lock.isEnabled, onCheckedChange = setEnabled, enabled = lock.canProtect && !lock.isAuthenticating && !lock.isLocked,
            modifier = Modifier.semantics { contentDescription = "Lock with device authentication" })
    })
}
