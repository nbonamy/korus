package com.nabocorp.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

@Composable internal fun RequestBanner(model: CompanionModel) {
    val requests = model.requests
    val first = requests.firstOrNull() ?: return
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { model.openRequest(first.key) }
            .semantics { contentDescription = "Review request: ${first.title}" }.padding(horizontal = 20.dp,vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (first.kind == "question") Icons.AutoMirrored.Outlined.HelpOutline else Icons.Outlined.PanTool,null,Modifier.size(22.dp))
            Text(first.title + if (requests.size > 1) " (${requests.size})" else "",Modifier.weight(1f),fontSize = 15.sp,fontWeight = FontWeight.SemiBold)
            Text("Review",fontSize = 15.sp)
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight,null,Modifier.size(16.dp))
        }
    }
}

@Composable internal fun RequestScreen(model: CompanionModel) {
    val pending = model.presentedRequest ?: return
    val busy = model.requestBusy
    val enabled = model.canRespond
    BackHandler { if (!busy) model.dismissRequest() }
    AppSheetFrame(if (busy) "" else pending.title, Modifier.imePadding(), leading = if (busy) null else ({ AppBarPill("Done", onClick = model::dismissRequest) }), scroll = !busy) {
        if (busy) AppProgress("Sending your response", Icons.AutoMirrored.Outlined.Send, "Waiting for ${model.productName} to confirm the response.")
        else Column(Modifier.fillMaxWidth().padding(bottom = 24.dp).testTag("request-form")) {
            if (pending.kind == "question") {
                pending.questions.forEach { question ->
                    AppSection(question.header) {
                        Text(question.text, Modifier.padding(16.dp), fontSize = 17.sp)
                        question.options.forEach { option ->
                            AppDivider()
                            val selected = option.label in model.requestDraft.selections[question.id].orEmpty()
                            val select = { model.toggleRequestOption(pending,question,option.label) }
                            val choice = if (question.multiple) Modifier.toggleable(value = selected,enabled = enabled,role = Role.Checkbox,onValueChange = { select() })
                                else Modifier.selectable(selected = selected,enabled = enabled,role = Role.RadioButton,onClick = select)
                            Row(Modifier.fillMaxWidth().then(choice).testTag("request-option-${question.id}-${option.label}").padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Icon(if (selected) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, Modifier.size(24.dp), tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(option.label, fontSize = 17.sp)
                                    if (option.description.isNotBlank()) Text(option.description, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        AppDivider()
                        OutlinedTextField(value = model.requestDraft.text[question.id].orEmpty(),onValueChange = { model.editRequest(pending,question,it) },
                            placeholder = { Text(if (question.options.isEmpty()) "Your answer" else "Or write your own answer") },enabled = enabled,
                            singleLine = question.secret,minLines = if (question.secret) 1 else 2,maxLines = if (question.secret) 1 else 6,
                            visualTransformation = if (question.secret) PasswordVisualTransformation() else VisualTransformation.None,
                            colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Color.Transparent, disabledBorderColor = Color.Transparent),
                            keyboardOptions = KeyboardOptions(capitalization = if (question.secret) KeyboardCapitalization.None else KeyboardCapitalization.Sentences,
                                autoCorrectEnabled = !question.secret,keyboardType = if (question.secret) KeyboardType.Password else KeyboardType.Text),
                            modifier = Modifier.fillMaxWidth().testTag("request-answer-${question.id}"))
                    }
                }
                AppSection {
                    AppRow("Send Answer", titleColor = MaterialTheme.colorScheme.primary, enabled = enabled && model.requestDraft.answers(pending.questions) != null, onClick = { model.respondRequest(pending) })
                    AppDivider()
                    AppRow("Skip Question", titleColor = MaterialTheme.colorScheme.primary, enabled = enabled, onClick = { model.respondRequest(pending,cancel = true) })
                }
            } else {
                AppSection {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (pending.kind == "approval") {
                            val approval = pending.request.obj("approval")
                            Text(approval.string("title"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            approval.string("description").takeIf(String::isNotBlank)?.let { Text(it, fontSize = 17.sp) }
                            approval.string("command").takeIf(String::isNotBlank)?.let { RequestCode(it) }
                            approval.string("cwd").takeIf(String::isNotBlank)?.let { RequestDetail("Folder",it) }
                            approval.items("requestedPermissions").forEach { permission ->
                                if (permission.string("kind") == "filesystem") RequestDetail(permission.string("access","Files").replaceFirstChar(Char::uppercase),permission.string("path"))
                                else if (permission.string("kind") == "network") RequestDetail("Network",if (!permission.optBoolean("enabled",true)) "Disabled" else listOf(permission.string("protocol"),permission.string("host")).filter(String::isNotBlank).joinToString(": "))
                            }
                        } else {
                            val confirmation = pending.request.obj("confirmation")
                            Text(confirmation.string("summary"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            RequestDetail(confirmation.string("integrationName"), confirmation.string("toolName"))
                            RequestCode(confirmation.string("argumentsPreview"))
                        }
                    }
                }
                AppSection {
                    pending.decisions.forEachIndexed { index, decision ->
                        if (index > 0) AppDivider()
                        AppRow(decision.label, titleColor = if (decision.value == "deny") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, enabled = enabled, onClick = { model.respondRequest(pending,decision.value) })
                    }
                }
            }
            if (model.state.string("failedRequest") == pending.key) Text("The response wasn’t confirmed. Your answer is still here. Check the connection and try again.", Modifier.padding(horizontal = 32.dp, vertical = 12.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
            if (model.state.string("connection") != "connected") {
                Text("Reconnect to your laptop to respond.", Modifier.padding(horizontal = 32.dp, vertical = 12.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable private fun RequestCode(text: String) {
    SelectionContainer { Text(text,fontFamily = FontFamily.Monospace,fontSize = 15.sp) }
}
@Composable private fun RequestDetail(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label,fontSize = 15.sp)
        SelectionContainer { Text(value,Modifier.weight(1f),fontSize = 15.sp,textAlign = androidx.compose.ui.text.style.TextAlign.End,color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
