package com.nabocorp.companion

import android.os.Build
import androidx.biometric.BiometricManager.Authenticators.*
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/** AndroidX retains the prompt through activity recreation and reconnects its result callback. */
class DeviceOwnerAuthenticator(activity: FragmentActivity, name: String, result: (Boolean) -> Unit) {
    private val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(value: BiometricPrompt.AuthenticationResult) { result(true) }
        override fun onAuthenticationError(code: Int, message: CharSequence) { result(false) }
    })
    private val productName = name
    private val complete = result
    fun authenticate(reason: String) {
        try {
            // Android 9/10 cannot combine STRONG with DEVICE_CREDENTIAL; AndroidX provides their credential fallback.
            val biometric = if (Build.VERSION.SDK_INT >= 30) BIOMETRIC_STRONG else BIOMETRIC_WEAK
            prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(productName)
                .setSubtitle(reason).setAllowedAuthenticators(biometric or DEVICE_CREDENTIAL).build())
        } catch (_: Exception) { complete(false) }
    }
    fun cancel() { prompt.cancelAuthentication() }
}
