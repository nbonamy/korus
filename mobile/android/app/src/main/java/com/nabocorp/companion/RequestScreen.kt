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
import androidx.compose.material.icons.outlined.Close
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
            Icon(if (first.kind == "question") Icons.AutoMirrored.Outlined.HelpOutline else Icons.Outlined.PanTool,null,Modifier.size(20.dp))
            Text(first.title + if (requests.size > 1) " (${requests.size})" else "",Modifier.weight(1f),style = MaterialTheme.typography.titleSmall)
            Text("Review",style = MaterialTheme.typography.labelLarge)
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight,null,Modifier.size(16.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun RequestScreen(model: CompanionModel) {
    val pending = model.presentedRequest ?: return
    val busy = model.requestBusy
    val enabled = model.canRespond
    BackHandler { if (!busy) model.dismissRequest() }
    Scaffold(modifier = Modifier.imePadding(),topBar = {
        TopAppBar(title = { Text(if (busy) "" else pending.title) },actions = {
            if (!busy) IconButton(onClick = model::dismissRequest) { Icon(Icons.Outlined.Close,"Close request") }
        })
    }) { padding ->
        if (busy) Column(Modifier.padding(padding).fillMaxSize().padding(32.dp),verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically),horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Text("Sending your response",style = MaterialTheme.typography.titleLarge)
            Text("Waiting for ${model.product.string("name")} to confirm the response.",color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("request-form"),verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (pending.kind == "question") {
                pending.questions.forEach { question ->
                    Text(question.header,style = MaterialTheme.typography.titleSmall,modifier = Modifier.semantics { heading() })
                    Text(question.text)
                    question.options.forEach { option ->
                        val selected = option.label in model.requestDraft.selections[question.id].orEmpty()
                        val select = { model.toggleRequestOption(pending,question,option.label) }
                        val choice = if (question.multiple) Modifier.toggleable(value = selected,enabled = enabled,role = Role.Checkbox,onValueChange = { select() })
                            else Modifier.selectable(selected = selected,enabled = enabled,role = Role.RadioButton,onClick = select)
                        Row(Modifier.fillMaxWidth().then(choice).testTag("request-option-${question.id}-${option.label}").padding(vertical = 8.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (question.multiple) Checkbox(selected,null,enabled = enabled) else RadioButton(selected,null,enabled = enabled)
                            Column(Modifier.weight(1f)) {
                                Text(option.label)
                                if (option.description.isNotBlank()) Text(option.description,style = MaterialTheme.typography.bodySmall,color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    OutlinedTextField(value = model.requestDraft.text[question.id].orEmpty(),onValueChange = { model.editRequest(pending,question,it) },
                        label = { Text(if (question.options.isEmpty()) "Your answer" else "Or write your own answer") },enabled = enabled,
                        singleLine = question.secret,minLines = if (question.secret) 1 else 2,maxLines = if (question.secret) 1 else 6,
                        visualTransformation = if (question.secret) PasswordVisualTransformation() else VisualTransformation.None,
                        keyboardOptions = KeyboardOptions(capitalization = if (question.secret) KeyboardCapitalization.None else KeyboardCapitalization.Sentences,
                            autoCorrectEnabled = !question.secret,keyboardType = if (question.secret) KeyboardType.Password else KeyboardType.Text),
                        modifier = Modifier.fillMaxWidth().testTag("request-answer-${question.id}"))
                    HorizontalDivider()
                }
                Button(onClick = { model.respondRequest(pending) },enabled = enabled && model.requestDraft.answers(pending.questions) != null,modifier = Modifier.fillMaxWidth()) { Text("Send Answer") }
                OutlinedButton(onClick = { model.respondRequest(pending,cancel = true) },enabled = enabled,modifier = Modifier.fillMaxWidth()) { Text("Skip Question") }
            } else {
                if (pending.kind == "approval") {
                    val approval = pending.request.obj("approval")
                    Text(approval.string("title"),style = MaterialTheme.typography.titleMedium)
                    approval.string("description").takeIf(String::isNotBlank)?.let { Text(it) }
                    approval.string("command").takeIf(String::isNotBlank)?.let { RequestCode(it) }
                    approval.string("cwd").takeIf(String::isNotBlank)?.let { RequestDetail("Folder",it) }
                    approval.items("requestedPermissions").forEach { permission ->
                        if (permission.string("kind") == "filesystem") RequestDetail(permission.string("access","Files").replaceFirstChar(Char::uppercase),permission.string("path"))
                        else if (permission.string("kind") == "network") RequestDetail("Network",if (!permission.optBoolean("enabled",true)) "Disabled" else listOf(permission.string("protocol"),permission.string("host")).filter(String::isNotBlank).joinToString(": "))
                    }
                } else {
                    val confirmation = pending.request.obj("confirmation")
                    Text(confirmation.string("summary"),style = MaterialTheme.typography.titleMedium)
                    Text("${confirmation.string("integrationName")} · ${confirmation.string("toolName")}",color = MaterialTheme.colorScheme.onSurfaceVariant)
                    RequestCode(confirmation.string("argumentsPreview"))
                }
                HorizontalDivider()
                pending.decisions.forEach { decision ->
                    if (decision.value == "deny") OutlinedButton(onClick = { model.respondRequest(pending,decision.value) },enabled = enabled,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),modifier = Modifier.fillMaxWidth()) { Text(decision.label) }
                    else Button(onClick = { model.respondRequest(pending,decision.value) },enabled = enabled,modifier = Modifier.fillMaxWidth()) { Text(decision.label) }
                }
            }
            if (model.state.string("failedRequest") == pending.key) Text("The response wasn’t confirmed. Your answer is still here. Check the connection and try again.",color = MaterialTheme.colorScheme.error)
            if (model.state.string("connection") != "connected") {
                Text("Reconnect to your computer to respond.",color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { model.command("reconnect") }) { Text("Reconnect") }
            }
        }
    }
}

@Composable private fun RequestCode(text: String) {
    SelectionContainer { Text(text,fontFamily = FontFamily.Monospace,style = MaterialTheme.typography.bodyMedium) }
}
@Composable private fun RequestDetail(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label,style = MaterialTheme.typography.labelMedium,color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer { Text(value) }
    }
}
