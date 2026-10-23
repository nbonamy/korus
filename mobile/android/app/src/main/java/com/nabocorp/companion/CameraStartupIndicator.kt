package com.nabocorp.companion

import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

/** A resumed camera must produce a preview or return to a recoverable native state. */
@Composable internal fun CameraStartupIndicator(owner: LifecycleOwner, ready: Boolean, unavailable: () -> Unit, modifier: Modifier = Modifier) {
    val currentUnavailable by rememberUpdatedState(unavailable)
    LaunchedEffect(owner,ready) {
        if (!ready) owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            delay(10_000)
            currentUnavailable()
        }
    }
    if (!ready) CircularProgressIndicator(modifier)
}
