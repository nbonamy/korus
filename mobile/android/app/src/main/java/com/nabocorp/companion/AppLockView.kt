package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
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
        BrandedEntry(name) {
            Button(onClick = unlock, enabled = !lock.isAuthenticating, shape = CircleShape, contentPadding = PaddingValues(horizontal = 24.dp), modifier = Modifier.heightIn(min = 44.dp)) {
                Icon(Icons.Outlined.Fingerprint, null, Modifier.size(22.dp)); Spacer(Modifier.width(8.dp)); Text("Unlock", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    } else content()
}

internal fun appLockFooter(lock: AppLock) = if (lock.canProtect) "Use your fingerprint, face or device PIN when the app opens and after five minutes away."
    else "Set a screen lock on this device to lock the app."

@Composable internal fun AppLockSettings(lock: AppLock, setEnabled: (Boolean) -> Unit) {
    AppRow("Lock with device authentication", icon = Icons.Outlined.Fingerprint, trailing = {
        Switch(checked = lock.isEnabled, onCheckedChange = setEnabled, enabled = lock.canProtect && !lock.isAuthenticating && !lock.isLocked,
            modifier = Modifier.semantics { contentDescription = "Lock with device authentication" })
    })
}
