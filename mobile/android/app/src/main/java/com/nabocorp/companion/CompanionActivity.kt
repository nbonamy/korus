package com.nabocorp.companion

import android.os.Bundle
import android.os.Build
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.ViewGroup
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Stop
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.json.JSONObject

class CompanionActivity : FragmentActivity() {
    private val model by viewModels<CompanionModel>()
    private lateinit var authenticator: DeviceOwnerAuthenticator
    private val dictationCapture by lazy { AndroidDictationCapture(applicationContext) }
    private var microphoneResult: ((Boolean) -> Unit)? = null
    private val photoPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else model.cancelAttachmentImport("Allow camera access in Settings, or add a photo from your library.")
    }
    private val pairingScanner = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) result.data?.getStringExtra("pairingCode")?.let(model::acceptPairingScan)
    }
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val result = microphoneResult; microphoneResult = null; result?.invoke(granted)
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) model.push.enable() else model.push.refresh()
    }
    private val photos = registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(ComposerDrafts.MAX_COUNT)) { model.pickedAttachments(it, true) }
    private val documents = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { model.pickedAttachments(it, false) }
    private val camera = registerForActivityResult(ActivityResultContracts.TakePicture()) { model.cameraResult(it) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        authenticator = DeviceOwnerAuthenticator(this, model.product.string("name"), model.appLock::authenticationResult)
        handleNotification(intent)
        enableEdgeToEdge()
        setContent {
            CompanionTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    CompanionApp(model, ::enableNotifications, ::pickAttachment,
                        { model.appLock.setEnabled(it, authenticator::authenticate) }, { model.appLock.unlock(authenticator::authenticate) }, ::toggleDictation, ::scanPairingCode)
                }
            }
        }
    }
    override fun onStart() {
        super.onStart()
        model.activity(true)
        model.appLock.unlock(authenticator::authenticate)
    }
    override fun onStop() {
        model.activity(false)
        super.onStop()
    }
    override fun onDestroy() {
        microphoneResult = null
        model.dictation.cancel()
        if (!isChangingConfigurations && ::authenticator.isInitialized) {
            authenticator.cancel()
            model.appLock.authenticationResult(false)
        }
        super.onDestroy()
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleNotification(intent) }
    private fun handleNotification(intent: Intent?) {
        intent?.getStringExtra(AttentionNotifications.EXTRA_NOTIFICATION)?.let { model.attention.tapped(it) }
    }
    fun toggleDictation() {
        model.toggleDictation(dictationCapture) { result ->
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) result(true)
            else { microphoneResult = result; microphonePermission.launch(android.Manifest.permission.RECORD_AUDIO) }
        }
    }
    private fun scanPairingCode() { if (!model.pairingBusy) pairingScanner.launch(Intent(this, PairingScannerActivity::class.java)) }
    private fun launchCamera() {
        if (model.appLock.isLocked) { model.cancelAttachmentImport("Unlock the app and try taking the photo again."); return }
        try { camera.launch(model.cameraDestination()) }
        catch (_: Exception) { model.cancelAttachmentImport("Couldn’t open the camera. Try Photos or Files.") }
    }
    fun enableNotifications() {
        if (!model.push.configured) { model.push.enable(); return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        } else if (!getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled()) {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } else model.push.enable()
    }
    private fun pickAttachment(source: AttachmentSource) {
        if (model.beginAttachmentImport() == null) return
        try {
            when (source) {
                AttachmentSource.PHOTOS -> photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                AttachmentSource.FILES -> documents.launch(arrayOf("*/*"))
                AttachmentSource.CAMERA -> if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera() else photoPermission.launch(android.Manifest.permission.CAMERA)
            }
        } catch (_: Exception) { model.cancelAttachmentImport("Couldn’t open the picker. Try Photos or Files.") }
    }
}

enum class AttachmentSource { PHOTOS, FILES, CAMERA }

@Composable internal fun WebContent(page: WebPage, modifier: Modifier = Modifier, interactive: Boolean = true) {
    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    if (page.usable) key(page) {
        AndroidView(factory = { page.configure(configuration); (page.view.parent as? ViewGroup)?.removeView(page.view); page.view }, modifier = modifier,
            update = { page.configure(configuration); it.isEnabled = interactive; it.importantForAccessibility = if (interactive) android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS })
    } else Box(modifier)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun CompanionApp(model: CompanionModel, enableNotifications: () -> Unit, pickAttachment: (AttachmentSource) -> Unit,
    setAppLockEnabled: (Boolean) -> Unit, unlock: () -> Unit, toggleDictation: () -> Unit, scanPairingCode: () -> Unit) {
    val state = model.state
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val coroutine = rememberCoroutineScope()
    LaunchedEffect(drawer.currentValue, drawer.targetValue) {
        model.drawerVisible = drawer.currentValue == DrawerValue.Open || drawer.targetValue == DrawerValue.Open
        model.acknowledge()
    }
    LaunchedEffect(state.string("agentId")) { if (!model.drawerVisible) drawer.close() }
    LaunchedEffect(model.navigationDismissal) { if (model.navigationDismissal > 0) drawer.close() }
    LaunchedEffect(model.sheet) { model.acknowledge() }
    LaunchedEffect(model.attachmentPreview) { model.acknowledge() }
    Box {
        // The engine stays mounted across native navigation, with no accessible or visible content.
        WebContent(model.engine, Modifier.size(1.dp),interactive = false)
        AppLockHost(model.appLock, model.productName, unlock) {
            if (model.fatalError || state.string("startup") == "error") {
                StartupFailure(model::retryStartup)
            } else if (model.engineRecovering || state.string("startup") != "ready" || state.has("teams") && state.items("teams").isEmpty() && !model.needsPairing && !state.connection.isConnected) {
                if (model.showConnectionLost) ConnectionLostContent { model.command("reconnect") }
                else StartupProgress(state.items("laptops").isNotEmpty(),model.productName)
            } else if (model.needsPairing) {
                PairingScreen(model, scanPairingCode)
            } else if (model.presentedRequest != null) {
                RequestScreen(model)
            } else if (model.changesOpen) {
                ChangesScreen(model)
            } else if (model.reviewOpen) {
                ReviewScreen(model)
            } else if (model.creation != null) {
                CreationScreen(model)
            } else {
                ModalNavigationDrawer(drawerState = drawer, drawerContent = {
                    ModalDrawerSheet(Modifier.widthIn(max = 360.dp), drawerContainerColor = MaterialTheme.colorScheme.background) {
                        DrawerContent(model, close = { coroutine.launch { drawer.close() } })
                    }
                }) {
                  if (model.missionsOpen) MissionsScreen(model) { coroutine.launch { drawer.open() } }
                  else {
                    Scaffold(
                        topBar = {
                            Column {
                                ConversationHeader(model) { coroutine.launch { drawer.open() } }
                                MissionContextBar(model)
                            }
                        },
                        bottomBar = { if (state.string("agentId").isNotBlank()) Column {
                            RequestBanner(model)
                            // A mission drives its workers; what they ask still arrives in the banner above.
                            if (model.workerMission == null) Composer(model, pickAttachment, toggleDictation)
                        } },
                        modifier = Modifier.imePadding(),
                    ) { padding ->
                        ConversationContent(model,Modifier.padding(padding).fillMaxSize())
                    }
                  }
                }
                if (model.sheet in listOf("settings", "connections", "usage")) {
                    BackHandler { if (model.sheet in listOf("usage", "connections")) model.sheet = "settings" else model.dismissSheet() }
                    Surface(Modifier.fillMaxSize(), color = CompanionColors.sheetBackground) { SheetContent(model, enableNotifications, setAppLockEnabled) }
                } else if (model.sheet != null && model.sheet != "conversation") {
                    ModalBottomSheet(onDismissRequest = model::dismissSheet, containerColor = CompanionColors.sheetBackground, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = {
                        it != SheetValue.Hidden || model.canDismissSheet
                    })) {
                        SheetContent(model, enableNotifications, setAppLockEnabled)
                    }
                }
            }
            NotificationBannerHost(model.attention, Modifier.align(Alignment.TopCenter).statusBarsPadding())
            (model.notificationError ?: model.push.error)?.let { error ->
                AlertDialog(onDismissRequest = { model.notificationError = null; model.push.error = null }, title = { Text("Notifications") }, text = { Text(error) }, confirmButton = { TextButton(onClick = { model.notificationError = null; model.push.error = null }) { Text("OK") } })
            }
            if (state.optBoolean("sessionActionFailed") && state.optJSONObject("closePreview")?.optBoolean("isLinkedWorktree") != true) {
                AlertDialog(onDismissRequest = { model.command("dismissSessionError") }, title = { Text("Session action failed") },
                    text = { Text("The laptop couldn’t complete the action. Check the connection and try again.") },
                    confirmButton = { TextButton(onClick = { model.command("dismissSessionError") }) { Text("OK") } })
            }
            if (model.duplicateFailed) {
                AlertDialog(onDismissRequest = { model.duplicateFailed = false }, title = { Text("Couldn’t duplicate the agent") },
                    text = { Text("Check the connection and try again.") },
                    confirmButton = { TextButton(onClick = { model.duplicateFailed = false }) { Text("OK") } })
            }
            model.agentRename?.let { RenameAgentDialog(model, it) }
            model.attachmentPreview?.let { AttachmentImageDialog(it) { model.attachmentPreview = null } }
            model.conversationImage?.let { ImagePreviewDialog(it, model::dismissConversationImage) }
        }
    }
}

@Composable internal fun Composer(model: CompanionModel, pickAttachment: (AttachmentSource) -> Unit, toggleDictation: () -> Unit) {
    val state = model.state
    val composer = state.obj("composer")
    val suggestion = state.string("suggestedPrompt").takeIf { it.isNotBlank() && !model.composerDrafts.goalMode && !composer.optBoolean("planMode") }
    val selected = state.items("models").firstOrNull { it.string("id") == composer.string("modelId") }
    val drafts = model.composerDrafts
    val catalogItems = (state.obj("skills").items("items") + state.obj("mentions").items("items")).map(ComposerSuggestion::parse)
    val editor = remember(drafts.target) { ComposerEditorState(model.draft, catalogItems) }
    editor.synchronize(model.draft, catalogItems)
    var editorFocused by remember(drafts.target) { mutableStateOf(false) }
    var dismissedQuery by remember(drafts.target) { mutableStateOf<ComposerQuery?>(null) }
    val editorFocus = remember { FocusRequester() }
    val dictation = model.dictation
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val expanded = editorFocused || drafts.goalMode || composer.optBoolean("planMode") || !drafts.empty || dictation.active || drafts.importing || drafts.error != null
    LaunchedEffect(model.drawerVisible, model.sheet) {
        if (model.drawerVisible || model.sheet != null) { focus.clearFocus(); keyboard?.hide() }
    }
    DisposableEffect(model) { onDispose { dictation.cancel() } }
    val query = editor.query?.takeIf { editorFocused && !model.drawerVisible && model.sheet == null && !dictation.active && !drafts.sending
        && state.connection.isConnected && drafts.target != null && it != dismissedQuery }
    val catalog = state.obj(if (query?.isSkill == true) "skills" else "mentions")
    val loadSuggestions = { model.command(if (query?.isSkill == true) "loadSkills" else "loadMentions") }
    LaunchedEffect(query?.trigger, drafts.target) { if (query != null) loadSuggestions() }
    LaunchedEffect(catalog.string("status")) { if (query != null && catalog.string("status") == "idle") loadSuggestions() }
    BackHandler(enabled = query != null) { dismissedQuery = query }
    val working = state.obj("header").string("status") in listOf("working", "awaitingInput")
    val stopping = working && drafts.empty && !drafts.goalMode && !drafts.sending
    val choosing = working && !drafts.goalMode && !stopping && !drafts.sending
    val enabled = if (stopping) state.connection.isConnected && state.obj("capabilities").optBoolean("interrupt")
        else !drafts.empty && !drafts.importing && !drafts.sending && state.optBoolean("canSend") && (!drafts.goalMode || !state.optBoolean("goalBusy")) && (drafts.items.isEmpty() || state.obj("capabilities").optBoolean("attachments"))
    var addMenu by remember { mutableStateOf(false) }
    var addPage by remember { mutableStateOf("root") }
    var modelMenu by remember { mutableStateOf(false) }
    var sendMenu by remember { mutableStateOf(false) }
    val sendAction: @Composable () -> Unit = {
        val label = when { drafts.sending -> "Sending"; stopping -> "Stop"; drafts.goalMode -> "Set goal"; choosing -> if (model.composerPreferences.followUpBehavior == "queue") "Queue message" else "Steer agent"; else -> "Send" }
        Box {
            Box(Modifier.size(48.dp).semantics { contentDescription = label }.combinedClickable(enabled = enabled, role = Role.Button, onLongClick = if (choosing) ({ sendMenu = true }) else null,
                    onClick = { if (stopping) model.command("interrupt") else model.send() }), contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp).clip(CircleShape).background(if (enabled || drafts.sending) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
                    if (drafts.sending) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else Icon(if (stopping) Icons.Filled.Stop else Icons.Filled.ArrowUpward, null, Modifier.size(20.dp), tint = Color.White)
                }
            }
            DropdownMenu(expanded = sendMenu, onDismissRequest = { sendMenu = false }) {
                DropdownMenuItem(text = { Text("Steer") }, leadingIcon = { Icon(Icons.Outlined.ArrowUpward, null) }, onClick = { sendMenu = false; model.send("steer") })
                DropdownMenuItem(text = { Text("Queue") }, leadingIcon = { Icon(Icons.Outlined.Inbox, null) }, onClick = { sendMenu = false; model.send("queue") })
            }
        }
    }
    val addAction: @Composable () -> Unit = {
        Box {
            IconButton(onClick = { addPage = "root"; addMenu = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Add, "Add", Modifier.size(26.dp)) }
            DropdownMenu(expanded = addMenu && addPage == "permissions", onDismissRequest = { addMenu = false }) {
                DropdownMenuItem(text = { Text("Permissions") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null) }, onClick = { addPage = "root" })
                HorizontalDivider()
                val permissions = state.obj("permissions")
                permissions.strings("presets").forEach { preset ->
                    DropdownMenuItem(text = { Text(preset.replace('-', ' ').split(' ').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }) }, trailingIcon = { MenuCheck(preset == permissions.string("approvalPreset")) },
                        enabled = model.canChoosePermissions, onClick = { addMenu = false; model.chooseApprovalPreset(preset) })
                }
                if (permissions.strings("presets").isNotEmpty() && permissions.items("modes").isNotEmpty()) HorizontalDivider()
                permissions.items("modes").forEach { mode ->
                    DropdownMenuItem(text = { Text(mode.string("label")) }, trailingIcon = { MenuCheck(mode.string("id") == permissions.string("permissionMode")) },
                        enabled = model.canChoosePermissions, onClick = { addMenu = false; model.choosePermissionMode(mode.string("id")) })
                }
            }
            DropdownMenu(expanded = addMenu && addPage == "root", onDismissRequest = { addMenu = false }) {
                DropdownMenuItem(text = { Text("Take Photo") }, leadingIcon = { Icon(Icons.Outlined.PhotoCamera, null) }, enabled = model.canAttach, onClick = { addMenu = false; pickAttachment(AttachmentSource.CAMERA) })
                DropdownMenuItem(text = { Text("Add Photos") }, leadingIcon = { Icon(Icons.Outlined.PhotoLibrary, null) }, enabled = model.canAttach, onClick = { addMenu = false; pickAttachment(AttachmentSource.PHOTOS) })
                DropdownMenuItem(text = { Text("Add Files") }, leadingIcon = { Icon(Icons.Outlined.AttachFile, null) }, enabled = model.canAttach, onClick = { addMenu = false; pickAttachment(AttachmentSource.FILES) })
                if (state.obj("capabilities").optBoolean("goals")) DropdownMenuItem(text = { Text("Goal mode") }, leadingIcon = { Icon(Icons.Outlined.TrackChanges, null) }, trailingIcon = { if (drafts.goalMode) Icon(Icons.Outlined.Check, null) },
                    enabled = state.optBoolean("canSend") && !drafts.sending && !drafts.importing && !dictation.active && drafts.items.isEmpty(), onClick = { addMenu = false; model.setGoalMode(!drafts.goalMode) })
                if (state.obj("capabilities").optBoolean("planMode")) DropdownMenuItem(text = { Text("Plan mode") }, leadingIcon = { Icon(Icons.Outlined.ListAlt, null) }, trailingIcon = { if (composer.optBoolean("planMode")) Icon(Icons.Outlined.Check, null) }, enabled = model.canTogglePlanMode, onClick = { addMenu = false; model.setPlanMode(!composer.optBoolean("planMode")) })
                if (state.obj("permissions").strings("presets").isNotEmpty() || state.obj("permissions").items("modes").isNotEmpty()) DropdownMenuItem(text = { Text("Permissions") }, leadingIcon={ Icon(Icons.Outlined.Security,null) },trailingIcon={ Icon(Icons.Outlined.ChevronRight,null) },enabled=model.canChoosePermissions,onClick={ addPage="permissions" })
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Review") }, leadingIcon = { Icon(Icons.Outlined.Checklist, null) }, enabled = model.canManageSession,
                    onClick = { addMenu = false; focus.clearFocus(); keyboard?.hide(); model.openReview() })
                DropdownMenuItem(text = { Text("Delegate") }, leadingIcon = { Icon(Icons.Outlined.AccountTree, null) },
                    enabled = state.optBoolean("canSend") && !drafts.sending && !drafts.importing && !dictation.active,
                    onClick = { addMenu = false; focus.clearFocus(); keyboard?.hide(); model.delegate() })
            }
        }
    }
    val dictationAction: @Composable () -> Unit = {
        IconButton(onClick = { focus.clearFocus(); keyboard?.hide(); toggleDictation() }, enabled = dictation.active || model.canDictate,
            modifier = Modifier.semantics {
                contentDescription = if (dictation.active) "Stop dictation" else "Dictate"
                stateDescription = when (dictation.phase) {
                    DictationController.Phase.REQUESTING -> "Requesting microphone access"
                    DictationController.Phase.STARTING -> "Starting dictation"
                    DictationController.Phase.RECORDING -> "Listening"
                    DictationController.Phase.FINISHING -> "Finishing dictation"
                    else -> ""
                }
            }) {
            Box(contentAlignment = Alignment.Center) {
                Icon(if (dictation.active) Icons.Outlined.Stop else Icons.Outlined.Mic, null,
                    tint = if (dictation.active) MaterialTheme.colorScheme.primary else LocalContentColor.current)
                if (dictation.phase in listOf(DictationController.Phase.REQUESTING, DictationController.Phase.STARTING, DictationController.Phase.FINISHING)) {
                    CircularProgressIndicator(Modifier.size(34.dp).clearAndSetSemantics {}, strokeWidth = 2.dp)
                }
            }
        }
    }
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp)) {
            if (query != null) {
                ComposerSuggestionsContent(query, catalog.string("status", "idle"), catalog.items("items").map(ComposerSuggestion::parse),
                    choose = { item ->
                        if (editor.choose(item)) { model.editDraft(editor.value.text); dismissedQuery = null; editorFocus.requestFocus(); keyboard?.show() }
                    }, dismiss = { dismissedQuery = query }, retry = loadSuggestions)
                Spacer(Modifier.height(6.dp))
            }
            if (state.items("queuedPrompts").isNotEmpty() || state.optBoolean("queuedPromptFailed")) {
                QueuedPromptsContent(state.items("queuedPrompts"), state.optJSONObject("composerTarget")?.let(ConversationTarget::parse),
                    state.connection.isConnected && state.string("sessionAction").isBlank(),
                    state.string("queuedPromptPending").takeIf { it.isNotBlank() }, state.optBoolean("queuedPromptFailed"), model::dispatch)
            }
            state.optJSONObject("goal")?.takeIf { it.string("status") != "complete" }?.let { goal ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.TrackChanges, null, Modifier.padding(start = 20.dp).size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant); Text(goal.string("objective"), Modifier.weight(1f).padding(10.dp), fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (state.optBoolean("goalBusy")) CircularProgressIndicator(Modifier.size(18.dp).testTag("goal-update-pending").semantics { contentDescription="Updating goal" },strokeWidth=2.dp)
                    IconButton(onClick = { model.setGoalMode(true); model.editDraft(goal.string("objective")) }, enabled = state.optBoolean("canSend") && !state.optBoolean("goalBusy") && drafts.items.isEmpty() && !drafts.sending && !drafts.importing) { Icon(Icons.Outlined.Edit, "Edit goal") }
                    IconButton(onClick = { model.command("clearGoal", "target" to state.obj("composerTarget")) }, enabled = state.optBoolean("canSend") && !state.optBoolean("goalBusy")) { Icon(Icons.Outlined.Close, "Clear goal") }
                }
            }
            if (state.optBoolean("goalError")) Text("Goal change couldn’t be confirmed. Check its status before trying again.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(horizontal=8.dp,vertical=4.dp))
            Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
                border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(10.dp)) {
                    if (drafts.goalMode || composer.optBoolean("planMode")) Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (drafts.goalMode) Icons.Outlined.TrackChanges else Icons.Outlined.ListAlt, null, Modifier.padding(start = 10.dp).size(16.dp))
                        Text(if (drafts.goalMode) "Goal" else "Plan", Modifier.weight(1f).padding(start = 6.dp), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        IconButton(onClick = { if(drafts.goalMode) model.setGoalMode(false) else model.setPlanMode(false) }, enabled = !drafts.sending && !state.optBoolean("goalBusy") && (drafts.goalMode || model.canTogglePlanMode)) { Icon(Icons.Outlined.Close, if(drafts.goalMode) "Exit goal mode" else "Exit plan mode") }
                    }
                    ComposerAttachmentsView(drafts) { model.attachmentPreview = it }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (!expanded) addAction()
                        val editorTarget = drafts.target
                        key(editorTarget) {
                            BasicTextField(value = editor.value, onValueChange = { next ->
                                if (model.composerDrafts.target == editorTarget) {
                                    editorFocused = true
                                    val accepted = if (editor.value.text.isEmpty() && next.text == " " && next.composition == null && suggestion != null)
                                        next.copy(text = suggestion, selection = androidx.compose.ui.text.TextRange(suggestion.length)) else next
                                    editor.edit(accepted)
                                    if (model.draft != editor.value.text) model.editDraft(editor.value.text)
                                }
                            },
                                visualTransformation = ComposerChipTransformation(editor.chips, MaterialTheme.colorScheme.onSecondaryContainer, MaterialTheme.colorScheme.secondaryContainer),
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).padding(horizontal = 8.dp).testTag("composer").focusRequester(editorFocus).onFocusChanged { editorFocused = it.isFocused },
                                maxLines = if (expanded) 8 else 1, singleLine = !expanded,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface), cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                                enabled = drafts.target != null && !drafts.sending && !dictation.active,
                                decorationBox = { input ->
                                    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                                        if (editor.value.text.isEmpty()) Text(when { drafts.goalMode -> "Describe your goal"; composer.optBoolean("planMode") -> "Describe what to plan"; else -> suggestion ?: "Message" },
                                            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = if (expanded) 8 else 1, overflow = TextOverflow.Ellipsis)
                                        input()
                                    }
                                })
                        }
                        if (!expanded) { dictationAction(); if (stopping || drafts.sending) sendAction() }
                    }
                    if (expanded) Row(verticalAlignment = Alignment.CenterVertically) {
                        addAction()
                        val fastTier = selected?.items("tiers")?.firstOrNull { it.string("id") in listOf("fast", "priority") }
                        if (state.obj("capabilities").optBoolean("serviceTier") && fastTier != null) {
                            val fast = composer.string("serviceTier") == fastTier.string("id")
                            IconToggleButton(checked = fast, onCheckedChange = { model.chooseServiceTier(if (it) fastTier.string("id") else null) }, enabled = model.canChooseModel,
                                modifier = Modifier.size(48.dp).semantics { contentDescription = "Fast mode"; stateDescription = if (fast) "On" else "Off" }) { Icon(if (fast) Icons.Filled.Bolt else Icons.Outlined.Bolt, null) }
                        }
                        Box(Modifier.weight(1f)) {
                            TextButton(onClick = { modelMenu = true }, enabled = model.canChooseModel, modifier = Modifier.semantics { contentDescription = "Choose model and reasoning" }) {
                                Text(selected?.string("name") ?: "Model", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                                composer.string("effort").takeIf { it.isNotBlank() }?.let { Text(" " + it.replaceFirstChar(Char::uppercase), maxLines = 1, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                Icon(Icons.Outlined.UnfoldMore, null, Modifier.padding(start = 4.dp).size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                                state.items("models").forEach { option ->
                                    DropdownMenuItem(text = { Text(option.string("name")) }, trailingIcon = { MenuCheck(option.string("id") == composer.string("modelId")) },
                                        enabled = model.canChooseModel, onClick = { modelMenu = false; model.chooseModel(option.string("id")) })
                                }
                                val efforts = selected?.strings("efforts").orEmpty()
                                if (efforts.isNotEmpty()) {
                                    HorizontalDivider()
                                    efforts.forEach { effort ->
                                        DropdownMenuItem(text = { Text(effort.replaceFirstChar(Char::uppercase)) }, trailingIcon = { MenuCheck(effort == composer.string("effort")) },
                                            enabled = model.canChooseModel, onClick = { modelMenu = false; model.chooseReasoningEffort(effort) })
                                    }
                                }
                            }
                        }
                        dictationAction()
                        sendAction()
                    }
                }
            }
        }
    }
    dictation.error?.let { error ->
        AlertDialog(onDismissRequest = { dictation.error = null }, title = { Text("Dictation unavailable") }, text = { Text(error) },
            confirmButton = { TextButton(onClick = { dictation.error = null }) { Text("OK") } })
    }
}

@Composable internal fun SheetContent(model: CompanionModel, enableNotifications: () -> Unit, setAppLockEnabled: (Boolean) -> Unit) {
    val state = model.state
    when (model.sheet) {
        "settings" -> AppSheetFrame("Settings", trailing = { AppBarPill("Done", model.canDismissSheet, onClick = model::dismissSheet) }) { SettingsContent(model, enableNotifications, setAppLockEnabled) }
        "connections" -> AppSheetFrame("Connections", leading = { AppBarIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to Settings") { model.sheet = "settings" } },
            trailing = { AppBarPill("Done", model.canDismissSheet, onClick = model::dismissSheet) }) { ConnectionsContent(model) }
        "usage" -> AppSheetFrame("Usage", leading = { AppBarIcon(Icons.AutoMirrored.Outlined.ArrowBack, "Settings") { model.sheet = "settings" } },
            trailing = { AppBarIcon(Icons.Outlined.Refresh, "Refresh usage", state.connection.isConnected && state.obj("usage").string("status") !in listOf("", "idle", "loading")) { model.command("loadUsage") } }) {
            UsageContent(state.obj("usage"), state.connection, { model.command("loadUsage") }, { model.command("reconnect") })
        }
        else -> Column(Modifier.fillMaxWidth().padding(bottom = 28.dp).heightIn(max = 650.dp)) {
            AppSheetHeader("Close Session", leading = { AppBarPill("Cancel", model.canDismissSheet, onClick = model::dismissSheet) })
            state.optJSONObject("closePreview")?.let { preview ->
                CloseSessionContent(preview, state.string("sessionAction").isNotBlank(), state.optBoolean("sessionActionFailed"), model.productName, model::dispatch, model::dismissSheet)
            }
        }
    }
}
