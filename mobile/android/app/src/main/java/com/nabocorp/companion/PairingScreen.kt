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
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = viewportHeight).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(28.dp)) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Image(painterResource(R.drawable.app_icon), null, Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)))
                    Text("Connect your laptop", Modifier.widthIn(max = 320.dp).semantics { heading() }, textAlign = TextAlign.Center, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Text("On your laptop, open ${model.product.string("desktopName")} Settings → Connections → Mobile access. Turn on Allow connections and choose Add device.",
                        Modifier.widthIn(max = 300.dp), textAlign = TextAlign.Center, fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val laptops = state.items("laptops").filter { it.string("id").isNotBlank() }
                val connecting = state.connection in setOf(Connection.Connecting, Connection.Reconnecting)
                if (laptops.size > 1 || laptops.size == 1 && !connecting) {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        laptops.forEach { laptop ->
                            Surface(Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                                Row(Modifier.clickable(enabled = !working, role = Role.Button) { model.command("connect", "laptopId" to laptop.string("id")) }
                                    .padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(laptop.string("name").ifBlank { "Laptop" }, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (working) 0.38f else 1f))
                                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (working) 0.38f else 1f))
                                }
                            }
                        }
                    }
                }
                if (connecting) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Text("Connecting…", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (state.connection == Connection.Error) PairingMessage("Laptop unavailable. Check it and the relay, then try again.", error = true)
            }
            Spacer(Modifier.height(32.dp))
            Column(Modifier.fillMaxWidth().padding(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (state.string("pairingError").isNotBlank()) PairingMessage(pairingRecovery(state.string("pairingError")), error = true)
                if (model.scanError) PairingMessage("That QR code is not a pairing code. Scan the code shown in Mobile access.", error = true)
                if (state.string("pairing") == "awaitingApproval") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.HourglassTop, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Approve this phone on your laptop.", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                }
                Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Row(Modifier.padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Spacer(Modifier.width(48.dp))
                        BasicTextField(value = code, onValueChange = model::editPairingCode, enabled = !working, singleLine = true,
                            modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("pairing-code").semantics { contentDescription = "Pairing code" },
                            textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurface),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
                            decorationBox = { field -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                if (code.isEmpty()) Text("XXXX-XXXX", fontFamily = FontFamily.Monospace, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
                                field()
                            } })
                        IconButton(onClick = scanPairingCode, enabled = !working, modifier = Modifier.size(width = 48.dp, height = 56.dp)) {
                            Icon(Icons.Outlined.PhotoCamera, "Scan laptop QR code", Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                TextButton(onClick = { openExternal(context, model.product.string("privacyUrl")) }) { Text("Privacy Policy", fontSize = 14.sp) }
            }
        }
    }
}

@Composable private fun PairingMessage(text: String, error: Boolean = false, modifier: Modifier = Modifier) {
    Text(text, modifier.semantics { liveRegion = LiveRegionMode.Polite }, textAlign = TextAlign.Center, fontSize = 13.sp,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun pairingRecovery(error: String): String = when (error) {
    "mobile.errors.noLaptop" -> "No laptop is showing this code. Check it and try again."
    "mobile.errors.codeMismatch" -> "That code did not match. Try again."
    "mobile.errors.codeFormat" -> "Enter the 8-character code."
    "mobile.errors.noRelay" -> "This build has no relay configured."
    "mobile.errors.pairingExpired" -> "Pairing expired. Create a new code in Mobile access on your laptop."
    else -> "Pairing failed. Check the code and try again."
}
