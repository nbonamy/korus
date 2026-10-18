package com.nabocorp.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun PairingScreen(model: CompanionModel, scanPairingCode: () -> Unit) {
    val code = model.pairingCode
    val state = model.state
    val working = model.pairingBusy
    val context = LocalContext.current
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        val viewportHeight = maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = viewportHeight).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Image(painterResource(R.drawable.app_icon), model.product.string("name"), Modifier.size(64.dp))
                Text("Connect your computer", Modifier.widthIn(max = 320.dp).semantics { heading() }, textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text("On your computer, open ${model.product.string("desktopName")} Settings → Connections → Mobile access. Turn on Allow connections and choose Add device.",
                    Modifier.widthIn(max = 320.dp), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val computers = state.items("laptops").filter { it.string("id").isNotBlank() }
                if (computers.isNotEmpty()) {
                    Text("Saved computers", Modifier.fillMaxWidth().padding(top = 12.dp).semantics { heading() },
                        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    computers.forEach { computer ->
                        Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                            Row(Modifier.fillMaxWidth().clickable(enabled = !working, role = Role.Button) { model.command("connect", "laptopId" to computer.string("id")) }
                                .heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(computer.string("name").ifBlank { "Computer" }, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (working) 0.38f else 1f))
                                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (working) 0.38f else 1f))
                            }
                        }
                    }
                }
                if (state.string("connection") in listOf("connecting", "reconnecting")) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text("Connecting…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (state.string("connection") == "error" && state.string("pairingError").isBlank()) {
                    PairingMessage("Computer unavailable. Check that it’s running and try again.", error = true)
                }
            }
            Spacer(Modifier.height(32.dp))
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                if (state.string("pairing") == "awaitingApproval") {
                    Row(Modifier.padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.HourglassTop, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        PairingMessage("Approve this phone in ${model.product.string("desktopName")} on your computer.")
                    }
                } else if (state.string("pairingError").isNotBlank()) {
                    PairingMessage(pairingRecovery(state.string("pairingError")), error = true, modifier = Modifier.padding(bottom = 16.dp))
                }
                if (model.scanError) PairingMessage("That QR code is not a pairing code. Scan the code shown in Mobile access.", error = true, modifier = Modifier.padding(bottom = 16.dp))
                OutlinedTextField(value = code, onValueChange = model::editPairingCode,
                    modifier = Modifier.fillMaxWidth().testTag("pairing-code"), label = { Text("Pairing code") },
                    shape = RoundedCornerShape(22.dp), textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                    isError = state.string("pairingError").isNotBlank() || model.scanError,
                    placeholder = { Text("XXXX-XXXX") }, enabled = !working, singleLine = true,
                    trailingIcon = { IconButton(onClick = scanPairingCode,enabled = !working) { Icon(Icons.Outlined.QrCodeScanner,"Scan computer QR code") } },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false))
                Spacer(Modifier.height(16.dp))
                Button(onClick = model::submitPairing, enabled = PairingCode.complete(code) && !working, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                    if (working) {
                        CircularProgressIndicator(Modifier.size(20.dp).clearAndSetSemantics {}, color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.string("pairing") == "awaitingApproval") "Waiting for approval" else "Connecting…")
                    } else Text("Connect")
                }
                Spacer(Modifier.height(16.dp))
                Text("End-to-end encrypted", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { openExternal(context, model.product.string("privacyUrl")) }) { Text("Privacy Policy") }
            }
        }
    }
}

@Composable private fun PairingMessage(text: String, error: Boolean = false, modifier: Modifier = Modifier) {
    Text(text, modifier.semantics { liveRegion = LiveRegionMode.Polite }, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun pairingRecovery(error: String): String = when (error) {
    "mobile.errors.noLaptop" -> "No computer is showing this code. Check Mobile access and try again."
    "mobile.errors.codeMismatch" -> "That code did not match. Check the code and try again."
    "mobile.errors.codeFormat" -> "Enter the 8-character pairing code."
    "mobile.errors.noRelay" -> "Pairing is unavailable in this app. Install the latest version or contact support."
    "mobile.errors.pairingExpired" -> "Pairing expired. Create a new code in Mobile access on your computer."
    else -> "Pairing failed. Check the code and try again."
}
