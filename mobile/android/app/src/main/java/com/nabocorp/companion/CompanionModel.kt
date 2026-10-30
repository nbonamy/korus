package com.nabocorp.companion

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.content.FileProvider
import android.net.Uri
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

fun JSONObject.string(key: String, fallback: String = ""): String = if (isNull(key)) fallback else optString(key, fallback)
/** Where the link to the laptop stands, as the engine reports it. */
val JSONObject.connection: Connection get() = Connection.of(string("connection"))
fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()
fun JSONObject.items(key: String): List<JSONObject> = optJSONArray(key)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } } ?: emptyList()
fun JSONObject.strings(key: String): List<String> = optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
fun json(vararg values: Pair<String, Any?>): JSONObject = JSONObject().apply { values.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }

/** Native shell state. Provider conversation frames pass untouched between the bundled pages. */
class CompanionModel(application: Application) : AndroidViewModel(application) {
    private val app = application as CompanionApplication
    val attention = app.attention
    val push = app.push
    val appLock = app.appLock
    private var screenUnlocked = !appLock.isLocked
    private var pendingNotification: ConversationTarget? = null
    private var navigatingNotification: ConversationTarget? = null
    var notificationError by mutableStateOf<String?>(null)
    val product = JSONObject(application.assets.open("product.json").bufferedReader().use { it.readText() })
    /** The name people read in the interface, not the store listing. */
    val productName get() = product.string("desktopName").ifBlank { product.string("name") }
    private val vault = SecureVault(application)
    var state by mutableStateOf(JSONObject())
        private set
    var fatalError by mutableStateOf(false)
        private set
    internal var engineRecovering by mutableStateOf(false)
        private set
    internal var conversationPresentation by mutableStateOf(ConversationPresentation())
        private set
    internal var showConnectionLost by mutableStateOf(false)
        private set
    private var connectionDeadline: Long? = null
    private var connectionNoticeJob: Job? = null
    internal val needsPairing get() = state.items("laptops").isEmpty() || state.connection.needsPairing
    internal var pairingCode by mutableStateOf("")
        private set
    internal var pairingPending by mutableStateOf(false)
        private set
    internal var scanError by mutableStateOf(false)
        private set
    private var pairingWasBusy = false
    internal val pairingBusy get() = pairingPending || state.string("pairing") != "idle"
    val dictation = DictationController()
    private var drawerState by mutableStateOf(false)
    var drawerVisible: Boolean
        get() = drawerState
        set(value) { drawerState = value; if (value) dictation.cancel() }
    internal var navigationDismissal by mutableIntStateOf(0)
        private set
    private var presentedSheet by mutableStateOf<String?>(null)
    var sheet: String?
        get() = presentedSheet
        set(value) { presentedSheet = value; if (value != null) dictation.cancel() }
    internal val canDismissSheet get() = sheet != "closeSession" || state.string("sessionAction").isBlank()
    internal fun dismissSheet() {
        val current = sheet ?: return
        if (!canDismissSheet) return
        if (current == "closeSession") command("cancelCloseSession")
        sheet = null
        acknowledge()
    }
    var reviewOpen by mutableStateOf(false)
        private set
    internal var reviewChoices by mutableStateOf(ReviewChoices())
    private var reviewLoadedBackend: String? = null
    internal var creation by mutableStateOf<CreationFlow?>(null)
        private set
    internal var changesOpen by mutableStateOf(false)
        private set
    internal var filePreviewOpen by mutableStateOf(false)
        private set
    internal fun dismissFilePreview() { transcript.call("companionTranscript", "closeFile", ""); filePreviewOpen = false; acknowledge() }
    private var changesTarget: ConversationTarget? = null
    private var requestSelection: PendingRequest? = null
    private var requestOpen by mutableStateOf(false)
    internal var requestDraft by mutableStateOf(RequestDraft())
        private set
    private var requestPending by mutableStateOf<String?>(null)
    private var requestWasBusy = false
    internal val requests get() = state.items("requests").mapNotNull(PendingRequest::parse)
    internal val presentedRequest get() = if (requestOpen) requestSelection?.let { selected -> requests.firstOrNull(selected::sameIdentity) } else null
    internal val requestBusy get() = presentedRequest?.let { requestPending == it.key || state.string("respondingRequest") == it.key } == true
    internal val canRespond get() = screenUnlocked && state.connection.isConnected && requestPending == null && state.string("respondingRequest").isBlank()
    private val preferences = application.getSharedPreferences("preferences", 0)
    internal val sidebar = SidebarPreferences(application.getSharedPreferences("sidebar", 0))
    private var preferredNewBackend by mutableStateOf(preferences.getString("newChat.backend", "").orEmpty())
    private var duplicateTarget by mutableStateOf<ConversationTarget?>(null)
    internal val duplicatingAgent get() = duplicateTarget != null
    internal var duplicateFailed by mutableStateOf(false)
    internal var agentRename by mutableStateOf<AgentRename?>(null)
    private fun preferredBackend(choices: List<String>) = preferredNewBackend.takeIf { choices.contains(it) } ?: choices.firstOrNull().orEmpty()
    internal val newBackend get() = preferredBackend(creation?.backends(state) ?: state.creationBackends())
    private val creationReady get() = state.connection.isConnected && state.string("laptopId", state.obj("composerTarget").string("hostId")).isNotBlank() && state.string("teamId").isNotBlank()
        && state.string("chatCreation") != "creating" && creation?.submitted != true && !duplicatingAgent
    internal val canStartCreation get() = canStartCreationFor()
    internal fun canStartCreationFor(repositoryId: String? = null) = creationReady && state.creationBackends(repositoryId).isNotEmpty()
    private val conversationBackends get() = if (state.has("conversationBackends")) state.strings("conversationBackends") else state.strings("backends")
    internal val canDuplicateAgent get() = canManageSession && creationReady && conversationBackends.isNotEmpty()
    val canManageSession get() = composerDrafts.target != null && state.connection.isConnected && state.string("sessionAction").isBlank()
    val composerDrafts = ComposerDrafts()
    val composerPreferences = ComposerPreferences(application.getSharedPreferences("preferences", 0))
    val draft get() = composerDrafts.text
    private var imagePreview by mutableStateOf<ComposerAttachment?>(null)
    internal var conversationImage by mutableStateOf<ImagePreview?>(null)
        private set
    internal fun dismissConversationImage() { conversationImage = null; acknowledge() }
    var attachmentPreview: ComposerAttachment?
        get() = imagePreview
        set(value) { imagePreview = value; if (value != null) dictation.cancel() }
    private var pickerImport: ComposerDrafts.Import? = null
    private var captureFile: File? = null
    private var captureUri: Uri? = null
    val canAttach get() = state.obj("capabilities").optBoolean("attachments") && composerDrafts.target != null && !composerDrafts.goalMode
        && !composerDrafts.importing && !composerDrafts.sending && !dictation.active && composerDrafts.items.size < ComposerDrafts.MAX_COUNT
    val canDictate get() = foreground && screenUnlocked && !drawerVisible && sheet == null && attachmentPreview == null && conversationImage == null
        && !reviewOpen && !changesOpen && !filePreviewOpen && creation == null && presentedRequest == null && composerDrafts.target != null && !composerDrafts.sending && !composerDrafts.importing
    var foreground = false
        private set
    private var engineReady = false
    private val commands = mutableListOf<JSONObject>()
    private var transcriptReady = false
    private var conversation: String? = null
    private var context: String? = null
    private var latestConversation: String? = null
    private var latestContext: String? = null
    private var rendering = false
    private var receipt: JSONObject? = null
    var renderedAgent by mutableStateOf("")
        private set
    var diff by mutableStateOf("")
        private set
    private var changesReady = false
    internal var changesPageFailed by mutableStateOf(false)
        private set
    var engine by mutableStateOf(page("engine"))
        private set
    var transcript by mutableStateOf(page("transcript"))
        private set
    var changes by mutableStateOf(page("changes"))
        private set
    private fun observePush() = push.observe { command("pushRegistration", "registration" to it) }
    private var stopPush = observePush()
    private val stopNotificationOpen = attention.bindOpen { target ->
        if (screenUnlocked && engineReady && !fatalError && !engineRecovering) openNotification(target) else pendingNotification = target
    }
    private val stopLock = appLock.observe { setUnlocked(!appLock.isLocked) }

    private fun openNotification(target: ConversationTarget) {
        dictation.cancel()
        dismissChanges()
        clearRequest()
        sheet = null; reviewOpen = false; creation = null; conversationImage = null; attachmentPreview = null
        navigationDismissal++
        navigatingNotification = target.takeIf { it != composerDrafts.target }
        command("openNotification", "target" to target.toJson())
        acknowledge()
    }

    private fun page(name: String) = WebPage(getApplication(), name, vault, product,
        receive = { _, message -> receive(name, message) }, failed = { pageFailed(name) },active = { foreground && screenUnlocked })

    private fun pageFailed(name: String) {
        when (name) {
            "engine" -> { engineReady = false; commands.clear(); composerDrafts.deliveryInterrupted(); dictation.cancel(); fatalError = true; engineRecovering = false }
            "transcript" -> {
                transcriptReady = false; rendering = false; receipt = null; renderedAgent = ""
                conversationPresentation = conversationPresentation.failedToRender()
            }
            "changes" -> { changesReady = false; changesPageFailed = true }
        }
        acknowledge()
    }
    internal fun retryStartup() {
        composerDrafts.deliveryInterrupted(); dictation.cancel(); commands.clear()
        engineReady = false; engineRecovering = true; fatalError = false
        engine.destroy(); engine = page("engine")
        stopPush(); stopPush = observePush()
        replaceTranscript()
        latestConversation = null; latestContext = null; conversation = null; context = null
        conversationPresentation = ConversationPresentation()
        if (!changes.usable) { changes.destroy(); changesReady = false; changesPageFailed = false; changes = page("changes") }
        acknowledge()
    }
    private fun replaceTranscript() {
        transcript.destroy(); transcriptReady = false; rendering = false; receipt = null; renderedAgent = ""
        transcript = page("transcript")
    }
    private fun beginTranscriptSelection(clearCache: Boolean) {
        rendering = false; receipt = null; renderedAgent = ""; conversation = null; context = null
        if (clearCache) { latestConversation = null; latestContext = null }
        if (!transcript.usable) replaceTranscript() else transcript.beginSelection()
    }
    internal fun retryConversation() {
        val id = state.string("agentId")
        if (id.isBlank() || !state.connection.isConnected) return
        conversationPresentation = ConversationPresentation(awaitingPaint = true).update(state).copy(fetchFailed = false)
        replaceTranscript()
        conversation = latestConversation; context = latestContext
        command("selectAgent","id" to id)
    }
    private fun acceptPaintedReceipt() {
        val read = receipt ?: return
        if (state.connection.isConnected && state.optBoolean("conversationReady") && transcript.usable
            && read.string("agentId") == state.string("agentId") && read.optInt("generation") == state.optInt("conversationGeneration") && !conversationPresentation.failed) {
            renderedAgent = read.string("agentId"); conversationPresentation = conversationPresentation.rendered()
        }
    }
    private fun updateConnectionNotice() {
        if (!foreground || !screenUnlocked || (state.connection.isConnected || state.connection.needsPairing) || needsPairing) {
            connectionNoticeJob?.cancel(); connectionNoticeJob = null; connectionDeadline = null; showConnectionLost = false; return
        }
        if (connectionDeadline != null) return
        val deadline = SystemClock.elapsedRealtime() + 5_000
        connectionDeadline = deadline
        connectionNoticeJob = viewModelScope.launch {
            delay((deadline-SystemClock.elapsedRealtime()).coerceAtLeast(0))
            if (connectionDeadline == deadline) showConnectionLost = true
        }
    }

    fun command(type: String, vararg values: Pair<String, Any?>) = dispatch(json("type" to type, *values))
    fun dispatch(command: JSONObject) {
        if (command.string("type") in listOf("selectAgent","selectTeam","connect","forget")) {
            pendingNotification = null; navigatingNotification = null
        }
        if (!engineReady) { commands.add(command); return }
        engine.call("companionEngine", "dispatch", command.toString())
    }
    fun activity(active: Boolean) {
        foreground = active; attention.foreground = active && screenUnlocked
        engine.activityChanged(); transcript.activityChanged(); changes.activityChanged(); updateConnectionNotice()
        if (active) push.refresh()
        if (!active) { attention.clear(); dictation.cancel() }
        command("activity", "active" to (active && screenUnlocked)); acknowledge()
    }
    fun setUnlocked(unlocked: Boolean) {
        if (screenUnlocked == unlocked) return
        screenUnlocked = unlocked
        engine.activityChanged(); transcript.activityChanged(); changes.activityChanged(); updateConnectionNotice()
        attention.foreground = foreground && unlocked
        if (!unlocked) { attention.clear(); dictation.cancel(); conversationImage = null }
        else if (engineReady && !fatalError && !engineRecovering) pendingNotification?.let { pendingNotification = null; openNotification(it) }
        command("activity", "active" to (foreground && unlocked))
        acknowledge()
    }
    fun editDraft(text: String, chips: List<ComposerChip> = emptyList()) {
        dictation.cancel()
        composerDrafts.text = text
        composerDrafts.chips = chips
    }
    internal fun editPairingCode(value: String) {
        if (pairingBusy) return
        scanError = false; pairingCode = PairingCode.format(value)
        if (PairingCode.complete(pairingCode)) submitPairing()
    }
    internal fun submitPairing() {
        if (pairingBusy || appLock.isLocked || !needsPairing || !PairingCode.complete(pairingCode)) return
        pairingPending = true; pairingWasBusy = false; scanError = false
        command("pair", "code" to pairingCode, "deviceName" to android.os.Build.MODEL)
    }
    internal fun acceptPairingScan(payload: String) {
        if (pairingBusy || appLock.isLocked || !needsPairing) return
        val code = PairingCode.scanned(payload)
        if (code == null) { scanError = true; return }
        pairingCode = code; submitPairing()
    }
    fun toggleDictation(capture: DictationCapture, authorize: ((Boolean) -> Unit) -> Unit) {
        if (dictation.active) dictation.finish()
        else if (canDictate) dictation.start(draft, capture, authorize) { composerDrafts.text = it }
    }
    /** The laptop's missions, and the one whose ticket worker is open: that worker is read-only except for what it asks. */
    internal val missions get() = state.items("missions")
    internal val workerMission: JSONObject? get() = state.optJSONObject("mission")
    /** The missions surface replaces the conversation in the main area, like a conversation does. */
    internal var missionsOpen by mutableStateOf(false)
    internal var missionDetail by mutableStateOf<String?>(null)
    /** Inside a mission: null on its page, "" on its review, a finding's id on that finding. */
    internal var missionReview by mutableStateOf<String?>(null)
    internal fun showMissions(id: String? = null) {
        dictation.cancel()
        drawerVisible = false
        missionDetail = id
        missionReview = null
        missionsOpen = true
    }
    /** A ticket's worker opens like any conversation; the mission stays one step back. */
    internal fun openTicket(agentId: String) {
        missionDetail = null
        selectAgent(agentId)
    }
    fun selectAgent(id: String) {
        missionsOpen = false
        if (id == state.string("agentId")) { drawerVisible = false; command("selectAgent","id" to id); acknowledge(); return }
        dictation.cancel()
        dismissChanges()
        clearRequest()
        drawerVisible = false; sheet = null; reviewOpen = false; creation = null; receipt = null; renderedAgent = ""
        beginTranscriptSelection(clearCache = true); conversationPresentation = ConversationPresentation()
        command("selectAgent", "id" to id)
    }
    internal fun openChanges() {
        if (!canManageSession || !state.obj("git").optBoolean("available")) return
        changesTarget = composerDrafts.target; changesOpen = true
        dictation.cancel(); sheet = null; acknowledge(); loadChanges()
    }
    internal fun loadChanges(scopeId: String? = null) {
        if (!changesOpen || changesTarget != composerDrafts.target || !state.connection.isConnected || !state.obj("git").optBoolean("available")) return
        if (scopeId != null && state.obj("git").items("choices").none { it.string("id") == scopeId }) return
        if (scopeId == null && state.obj("git").string("status") == "loading") return
        if (!changes.usable) { changes.destroy(); changesReady = false; changesPageFailed = false; changes = page("changes") }
        clearPatch()
        dispatch(if (scopeId == null) json("type" to "loadChanges") else json("type" to "loadChanges","scopeId" to scopeId))
    }
    internal fun dismissChanges() {
        if (!changesOpen) return
        changesOpen = false; changesTarget = null; clearPatch()
        command("dismissChanges"); acknowledge()
    }
    private fun clearPatch() {
        diff = ""
        if (changesReady) changes.call("companionChanges","setDiff",json("diff" to "").toString())
    }
    internal fun openRequest(key: String) {
        if (!screenUnlocked) return
        val pending = requests.firstOrNull { it.key == key } ?: return
        if (requestSelection?.sameIdentity(pending) != true) requestDraft = RequestDraft()
        requestSelection = pending; requestOpen = true
        dictation.cancel(); sheet = null; acknowledge()
    }
    internal fun dismissRequest() {
        if (requestBusy) return
        requestOpen = false; acknowledge()
    }
    internal fun editRequest(pending: PendingRequest, question: PendingRequest.Question, text: String) {
        if (canRespond && presentedRequest?.sameContent(pending) == true && question in pending.questions) requestDraft = requestDraft.edit(question.id,text)
    }
    internal fun toggleRequestOption(pending: PendingRequest, question: PendingRequest.Question, label: String) {
        if (canRespond && presentedRequest?.sameContent(pending) == true && question in pending.questions) requestDraft = requestDraft.toggle(question,label)
    }
    internal fun respondRequest(pending: PendingRequest, decision: String? = null, cancel: Boolean = false) {
        if (!canRespond || presentedRequest?.sameContent(pending) != true) return
        val outcome = if (pending.kind == "question") {
            if (cancel) json("kind" to "cancelled") else json("kind" to "answered","answers" to (requestDraft.answers(pending.questions) ?: return))
        } else {
            if (decision == null || pending.decisions.none { it.value == decision }) return
            json("kind" to "decision","decision" to decision)
        }
        requestPending = pending.key; requestWasBusy = false
        command("respondRequest","reply" to pending.reply(outcome))
    }
    private fun clearRequest() {
        requestSelection = null; requestOpen = false; requestDraft = RequestDraft(); requestPending = null; requestWasBusy = false
    }
    private fun reconcileRequest(next: JSONObject) {
        val selected = requestSelection ?: return
        val pending = next.items("requests").mapNotNull(PendingRequest::parse).firstOrNull(selected::sameIdentity)
        if (pending == null) { clearRequest(); return }
        if (selected.questions != pending.questions) requestDraft = RequestDraft()
        requestSelection = pending
        if (requestPending != null) {
            if (next.string("respondingRequest") == requestPending) requestWasBusy = true
            else if (requestWasBusy || next.string("failedRequest") == requestPending) { requestPending = null; requestWasBusy = false }
        }
    }
    fun openReview() {
        if (!canManageSession) return
        reviewChoices = ReviewChoices(); reviewLoadedBackend = null
        updateReviewChoices(state.obj("review"))
        dictation.cancel(); sheet = null; reviewOpen = true; acknowledge()
        command("loadReview")
    }
    private fun updateReviewChoices(review: JSONObject) {
        val setup = review.optJSONObject("setup") ?: return
        if (review.string("status") == "ready" && (reviewLoadedBackend == null || reviewLoadedBackend != setup.string("backend"))) {
            reviewChoices = reviewChoices.load(setup, reviewLoadedBackend == null)
            reviewLoadedBackend = setup.string("backend")
        }
    }
    fun dismissReview() {
        if (state.obj("review").string("status") == "starting") return
        reviewOpen = false; command("dismissReview"); acknowledge()
    }
    internal fun startReview(choices: ReviewChoices) {
        val review = state.obj("review")
        val setup = review.optJSONObject("setup") ?: return
        if (!reviewOpen || review.string("status") != "ready" || !state.optBoolean("canSend") ||
            setup.optJSONObject("target")?.let(ConversationTarget::parse) != composerDrafts.target) return
        choices.input(setup)?.let { command("review", "target" to setup.obj("target"), "input" to it) }
    }
    fun delegate() {
        if (!state.optBoolean("canSend") || composerDrafts.sending || composerDrafts.importing || dictation.active) return
        command("delegate", "startingContext" to "handoff")
    }
    internal fun chooseSidebarIdleSort(order: String) {
        if (sidebar.sortIdle(order)) command("idleSort", "order" to order)
    }
    internal val selectedModel get() = state.items("models").firstOrNull { it.string("id") == state.obj("composer").string("modelId") }
    internal val canChooseModel get() = state.connection.isConnected && state.items("models").isNotEmpty()
    internal fun chooseModel(id: String) {
        if (!canChooseModel || !state.items("models").any { it.string("id") == id }) return
        command("composer", "change" to json("modelId" to id)); sheet = null
    }
    internal fun chooseReasoningEffort(effort: String) {
        if (!canChooseModel || selectedModel?.strings("efforts")?.contains(effort) != true) return
        command("composer", "change" to json("reasoningEffort" to effort)); sheet = null
    }
    internal fun chooseServiceTier(tier: String?) {
        if (!canChooseModel || !state.obj("capabilities").optBoolean("serviceTier") || tier != null && selectedModel?.items("tiers")?.any { it.string("id") == tier } != true) return
        command("composer", "change" to json("serviceTier" to tier))
    }
    internal val canChoosePermissions get() = canManageSession && !composerDrafts.sending
    internal fun chooseApprovalPreset(preset: String) {
        if (!canChoosePermissions || !state.obj("permissions").strings("presets").contains(preset)) return
        command("approvalPreset","preset" to preset); sheet = null
    }
    internal fun choosePermissionMode(mode: String) {
        if (!canChoosePermissions || state.obj("permissions").items("modes").none { it.string("id") == mode }) return
        command("permissionMode","mode" to mode); sheet = null
    }
    internal val canRestartSession get() = canManageSession && state.obj("header").string("status") !in listOf("working","awaitingInput")
    internal fun restartSession() {
        if (!canRestartSession) return
        dictation.cancel(); command("restartSession"); sheet = null
    }
    internal fun closeSession() {
        if (!canManageSession) return
        dictation.cancel(); command("closeSession"); sheet = null
    }
    internal fun chooseCreationBackend(backend: String) {
        if (!(creation?.backends(state) ?: state.creationBackends()).contains(backend) || creation?.submitted == true) return
        preferredNewBackend = backend; preferences.edit().putString("newChat.backend", backend).apply()
    }
    internal fun openAgentRename() {
        if (!canManageSession) return
        val target = ConversationTarget.parse(state.obj("composerTarget")) ?: return
        command("dismissSessionError")
        dictation.cancel(); sheet = null
        agentRename = AgentRename(target, state.obj("header").string("title"))
    }
    internal fun renameAgent(target: ConversationTarget, name: String) {
        if (!canManageSession || target != ConversationTarget.parse(state.obj("composerTarget"))) return
        agentRename = null
        command("renameAgent", "target" to target.toJson(), "name" to name)
    }
    internal fun duplicateAgent() {
        if (!canDuplicateAgent) return
        val target = ConversationTarget.parse(state.obj("composerTarget")) ?: return
        val backend = state.string("backend").takeIf { conversationBackends.contains(it) } ?: preferredBackend(conversationBackends)
        if (state.string("chatCreation") == "failed") command("dismissNewChat")
        dictation.cancel(); sheet = null
        duplicateFailed = false; duplicateTarget = target
        command("duplicateAgent", "target" to target.toJson(), "backend" to backend)
    }
    private fun projectCatalogCommand(type: String, flow: CreationFlow, repositoryId: String? = null) {
        val fields = mutableListOf<Pair<String, Any?>>()
        if (repositoryId != null) fields += "repositoryId" to repositoryId
        if (flow.projectSource != "github") fields += "source" to flow.projectSource
        command(type, *fields.toTypedArray())
    }
    internal fun openCreation(kind: CreationKind, repositoryId: String? = null, repositoryName: String = "") {
        val repositoryTarget = kind in listOf(CreationKind.EXISTING, CreationKind.WORKTREE, CreationKind.DEFAULT)
        if (!canStartCreationFor(repositoryId.takeIf { repositoryTarget }) || repositoryTarget && repositoryId.isNullOrBlank()) return
        if (state.string("chatCreation") == "failed") command("dismissNewChat")
        creation = CreationFlow(state.string("laptopId", state.obj("composerTarget").string("hostId")), state.string("teamId"), kind, repositoryId, repositoryName)
        dictation.cancel(); sheet = null; reviewOpen = false; drawerVisible = false; acknowledge()
        when (kind) {
            CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL -> projectCatalogCommand("loadProjectRepositories", creation!!)
            CreationKind.EXISTING -> command("loadBranches", "repositoryId" to repositoryId)
            CreationKind.QUICK, CreationKind.DEFAULT -> submitCreation()
            else -> Unit
        }
    }
    internal fun editCreation(change: (CreationFlow) -> CreationFlow) {
        creation?.takeIf { !it.submitted && state.string("chatCreation") != "creating" }?.let { creation = change(it) }
    }
    internal fun selectCreationRepository(repository: JSONObject) {
        val flow = creation ?: return
        if (!flow.projectCatalog || !canStartCreation || !state.obj("projectRepositories").items("items").any { it.string("id") == repository.string("id") }) return
        creation = flow.copy(repositoryId = repository.string("id"), repositoryName = repository.string("name"), branchQuery = "")
        projectCatalogCommand("loadProjectBranches", flow, repository.string("id"))
    }
    internal fun newCreationBranch() {
        val flow = creation ?: return
        val catalog = flow.catalog(state)
        if (flow.submitted || !flow.projectCatalog || catalog.string("status") != "loaded" || catalog.items("items").isEmpty()) return
        if (state.string("chatCreation") == "failed") command("dismissNewChat")
        creation = flow.copy(newBranch = true, branchName = "", baseBranch = (catalog.items("items").firstOrNull { it.optBoolean("isDefault") } ?: catalog.items("items").first()).string("name"))
    }
    internal fun submitCreation(branch: String? = null) {
        val flow = creation ?: return
        val selected = if (branch != null) flow.copy(selectedBranch = branch) else flow
        val request = selected.command(state, newBackend) ?: return
        chooseCreationBackend(newBackend)
        creation = selected.copy(submitted = true)
        dispatch(request)
    }
    internal fun backCreation() {
        val flow = creation ?: return
        if (flow.submitted || state.string("chatCreation") == "creating") return
        if (state.string("chatCreation") == "failed") command("dismissNewChat")
        if (flow.newBranch) creation = flow.copy(newBranch = false, branchName = "", selectedBranch = null)
        else if (flow.projectCatalog && flow.repositoryId != null) {
            creation = flow.copy(repositoryId = null, repositoryName = "", branchQuery = "", selectedBranch = null)
            command("dismissProjectBranches")
        } else dismissCreation()
    }
    internal fun dismissCreation() {
        val flow = creation ?: return
        if (flow.submitted || state.string("chatCreation") == "creating") return
        creation = null
        if (state.string("chatCreation") == "failed") command("dismissNewChat")
        when (flow.kind) {
            CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL -> command("dismissProjectRepositories")
            CreationKind.EXISTING -> command("dismissBranches")
            else -> Unit
        }
        acknowledge()
    }
    internal fun refreshCreation() {
        val flow = creation ?: return
        if (flow.submitted || !state.connection.isConnected) return
        when (flow.kind) {
            CreationKind.EXISTING -> command("loadBranches", "repositoryId" to flow.repositoryId)
            CreationKind.GITHUB, CreationKind.GITLAB, CreationKind.LOCAL -> if (flow.repositoryId == null) projectCatalogCommand("loadProjectRepositories", flow) else projectCatalogCommand("loadProjectBranches", flow, flow.repositoryId)
            else -> Unit
        }
    }
    fun send(mode: String? = null) {
        if (!state.optBoolean("canSend") || composerDrafts.goalMode && (!state.obj("capabilities").optBoolean("goals") || state.optBoolean("goalBusy"))
            || composerDrafts.items.isNotEmpty() && !state.obj("capabilities").optBoolean("attachments")) return
        dictation.cancel()
        composerDrafts.beginSend(mode ?: composerPreferences.followUpBehavior)?.let(::dispatch)
    }
    fun setGoalMode(enabled: Boolean) {
        if (composerDrafts.sending || state.optBoolean("goalBusy")) return
        if (enabled && (!state.optBoolean("canSend") || !state.obj("capabilities").optBoolean("goals") || dictation.active)) return
        composerDrafts.setGoalMode(enabled)
        if (composerDrafts.goalMode) command("composer", "change" to json("planMode" to false))
    }
    fun setPlanMode(enabled: Boolean) {
        if (!canTogglePlanMode) return
        if (enabled) composerDrafts.setGoalMode(false)
        command("composer", "change" to json("planMode" to enabled))
    }
    internal val canTogglePlanMode get() = state.connection.isConnected && composerDrafts.target != null
        && state.obj("capabilities").optBoolean("planMode") && !composerDrafts.sending && !state.optBoolean("goalBusy")
    fun beginAttachmentImport(): ComposerDrafts.Import? {
        if (!canAttach) return null
        return composerDrafts.beginImport()?.also { pickerImport = it }
    }
    fun cancelAttachmentImport(error: String? = null) {
        pickerImport?.let { composerDrafts.finishImport(it, emptyList(), error) }; pickerImport = null
        captureFile?.delete(); captureFile = null; captureUri = null
    }
    fun pickedAttachments(uris: List<Uri>, images: Boolean): Job? {
        val request = pickerImport ?: return null
        pickerImport = null
        return viewModelScope.launch {
            try {
                require(uris.size <= ComposerDrafts.MAX_COUNT) { "You can attach up to 5 files or photos." }
                val items = withContext(Dispatchers.IO) { uris.map { AttachmentLoader.load(getApplication(), it, images) } }
                composerDrafts.finishImport(request, items)
            } catch (failure: Exception) {
                composerDrafts.finishImport(request, emptyList(), if (failure is IllegalArgumentException) failure.message else "Couldn’t read that attachment. Try selecting it again.")
            }
        }
    }
    fun cameraDestination(): Uri {
        check(pickerImport != null)
        val folder = File(getApplication<Application>().cacheDir, "camera").apply { mkdirs() }
        val file = File.createTempFile("Photo-", ".jpg", folder)
        return FileProvider.getUriForFile(getApplication(), "${getApplication<Application>().packageName}.attachments", file).also { captureFile = file; captureUri = it }
    }
    fun cameraResult(success: Boolean) {
        val file = captureFile; val uri = captureUri
        captureFile = null; captureUri = null
        val importing = pickedAttachments(if (success && uri != null) listOf(uri) else emptyList(), true)
        if (importing != null) importing.invokeOnCompletion { file?.delete() } else file?.delete()
    }
    fun acknowledge() {
        if (navigatingNotification != null || fatalError || engineRecovering || !state.connection.isConnected || !state.optBoolean("conversationReady") || !transcript.usable) { attention.visibleTarget = null; return }
        attention.visibleTarget = if (foreground && screenUnlocked && !drawerVisible && !reviewOpen && !changesOpen && !filePreviewOpen && creation == null && presentedRequest == null && sheet == null && attachmentPreview == null && conversationImage == null && renderedAgent == state.string("agentId") && state.string("startup") == "ready")
            state.optJSONObject("composerTarget")?.let(ConversationTarget::parse) else null
        val read = receipt ?: return
        if (!foreground || !screenUnlocked || drawerVisible || reviewOpen || changesOpen || filePreviewOpen || creation != null || presentedRequest != null || sheet != null || attachmentPreview != null || conversationImage != null || read.string("agentId") != state.string("agentId")
            || read.optInt("generation") != state.optInt("conversationGeneration")) return
        dispatch(JSONObject(read.toString()).put("type", "read"))
    }
    private fun receive(page: String, message: Any?) {
        val body = when (message) { is JSONObject -> message; is String -> runCatching { JSONObject(message) }.getOrNull(); else -> null } ?: return
        if (page == "engine") {
            if (body.string("type") == "ready") {
                engineReady = true; engine.call("companionEngine", "start")
                commands.toList().also { commands.clear() }.forEach(::dispatch)
                command("activity", "active" to (foreground && screenUnlocked))
                if (screenUnlocked) pendingNotification?.let { pendingNotification = null; openNotification(it) }
                return
            }
            val payload = body.string("json")
            when (body.string("type")) {
                "notification" -> attention.receive(JSONObject(payload).getJSONObject("notification").toString())
                "notificationOpenFailed" -> { navigatingNotification = null; notificationError = "This conversation is no longer available on the paired laptop."; acknowledge() }
                "state" -> {
                    val next = JSONObject(payload).getJSONObject("state")
                    if (engineRecovering && next.string("startup") == "ready") engineRecovering = false
                    reconcileRequest(next)
                    if (next.items("laptops").isNotEmpty() && !next.connection.needsPairing) { pairingCode = ""; pairingPending = false; pairingWasBusy = false; scanError = false }
                    else if (next.string("pairing") != "idle") pairingWasBusy = true
                    else if (pairingWasBusy || next.string("pairingError").isNotBlank()) { pairingPending = false; pairingWasBusy = false }
                    val oldId = state.string("agentId"); val nextId = next.string("agentId")
                    val nextTarget = next.optJSONObject("composerTarget")?.let(ConversationTarget::parse)
                    if (oldId != nextId) missionsOpen = false
                    if (agentRename?.target != nextTarget) agentRename = null
                    duplicateTarget?.let { source ->
                        if (source != nextTarget || state.string("chatCreation") == "creating" && next.string("chatCreation") == "idle") duplicateTarget = null
                        else if (next.string("chatCreation") == "failed") { duplicateTarget = null; duplicateFailed = true }
                    }
                    if (nextTarget != composerDrafts.target || nextTarget == navigatingNotification) navigatingNotification = null
                    if (composerDrafts.target != nextTarget || state.string("agentId") != next.string("agentId")) {
                        beginTranscriptSelection(clearCache = true); conversationPresentation = ConversationPresentation()
                    } else if (state.optInt("conversationGeneration") != next.optInt("conversationGeneration")) beginTranscriptSelection(clearCache = false)
                    conversationPresentation = conversationPresentation.update(next)
                    if (changesOpen && (changesTarget != nextTarget || next.connection.isConnected && !next.obj("git").optBoolean("available"))) dismissChanges()
                    val reloadChanges = changesOpen && !state.connection.isConnected && next.connection.isConnected
                    if (sidebar.select(next.string("laptopId", next.obj("composerTarget").string("hostId")), if (next.optBoolean("allTeams")) "__all__" else next.string("teamId"))) command("idleSort", "order" to sidebar.idleSort)
                    creation?.let { flow ->
                        creation = when {
                            flow.hostId != next.string("laptopId", next.obj("composerTarget").string("hostId")) || flow.teamId != next.string("teamId") -> null
                            !next.connection.isConnected || next.string("chatCreation") == "failed" -> flow.copy(submitted = false, observedCreating = false)
                            next.string("chatCreation") == "creating" -> flow.copy(submitted = true, observedCreating = true)
                            flow.submitted && (flow.observedCreating || nextId != oldId) && next.string("chatCreation") == "idle" -> null
                            else -> flow
                        }
                    }
                    if (oldId != nextId || composerDrafts.target != nextTarget) {
                        dictation.cancel()
                        val reviewId = state.obj("review").obj("details").obj("session").string("id")
                        val sameReview = reviewId.isNotBlank() && reviewId == next.obj("review").obj("details").obj("session").string("id")
                            && composerDrafts.target?.copy(sessionId = nextTarget?.sessionId) == nextTarget && oldId == nextId
                        if (!sameReview) { reviewOpen = false; reviewChoices = ReviewChoices(); reviewLoadedBackend = null }
                        receipt = null; renderedAgent = ""; attachmentPreview = null; conversationImage = null; filePreviewOpen = false
                    }
                    composerDrafts.select(nextTarget)
                    if (!next.obj("capabilities").optBoolean("goals") || next.obj("composer").optBoolean("planMode")) composerDrafts.setGoalMode(false)
                    if (next.optJSONObject("closePreview")?.optBoolean("isLinkedWorktree") == true) sheet = "closeSession"
                    else if (sheet == "closeSession") sheet = null
                    if (next.obj("review").string("status") == "started") reviewOpen = false
                    if (reviewOpen) updateReviewChoices(next.obj("review"))
                    state = next; acceptPaintedReceipt(); updateConnectionNotice(); acknowledge()
                    if (reloadChanges) loadChanges()
                }
                "conversation" -> {
                    latestConversation = payload; latestContext = null; conversation = payload; context = null
                    if (!conversationPresentation.hasTranscript) conversationPresentation = conversationPresentation.copy(awaitingPaint = true)
                    drainTranscript()
                }
                "conversationContext" -> { latestContext = payload; context = payload; drainTranscript() }
                "turnHistory" -> transcript.call("companionTranscript", "setContent", payload)
                "conversationContent" -> transcript.call("companionTranscript", "setContent", payload)
                "conversationFile" -> transcript.call("companionTranscript", "setContent", payload)
                "conversationImage" -> transcript.call("companionTranscript", "setImage", payload)
                "gitDiff" -> if (changesOpen && changesTarget == composerDrafts.target) {
                    diff = JSONObject(payload).string("diff"); if (changesReady) changes.call("companionChanges", "setDiff", payload)
                }
                "sendResult" -> {
                    val result = JSONObject(payload)
                    composerDrafts.completeSend(result.string("requestId"), result.string("status"))
                }
            }
        } else if (page == "transcript") {
            when (body.string("type")) {
                "ready" -> { transcriptReady = true; drainTranscript() }
                "loadOlder" -> command("loadOlder", "agentId" to body.string("agentId"))
                "readConversationImage", "readConversationContent", "readFilePreview", "loadTurnHistory" -> dispatch(body)
                "filePreviewVisibility" -> { filePreviewOpen = body.optBoolean("open"); if (filePreviewOpen) dictation.cancel(); acknowledge() }
                "backend" -> { chooseCreationBackend(body.string("backend")); dispatch(body) }
                "openExternal" -> openExternal(getApplication(), body.string("url"))
                "openImage" -> if (foreground && screenUnlocked && !fatalError && !engineRecovering && state.string("agentId").isNotBlank()
                    && body.string("agentId") == state.string("agentId") && !drawerVisible && sheet == null && !reviewOpen && !changesOpen && creation == null && presentedRequest == null) {
                    dictation.cancel()
                    conversationImage = ImagePreview(body.string("title").ifBlank { "Image" },ImagePreview.Source.Displayed(body.string("src")))
                    acknowledge()
                }
                "rendered" -> {
                    val painted = body.optJSONObject("receipt")
                    if (painted != null && (painted.string("agentId") != state.string("agentId") || painted.optInt("generation") != state.optInt("conversationGeneration"))) return
                    rendering = false
                    if (painted != null) { receipt = painted; acceptPaintedReceipt(); acknowledge() }
                    drainTranscript()
                }
            }
        } else if (page == "changes" && body.string("type") == "ready") {
            changesReady = true; changes.call("companionChanges", "setDiff", json("diff" to diff).toString())
        }
    }
    private fun drainTranscript() {
        if (!transcriptReady || rendering) return
        val method: String; val payload: String
        if (conversation != null) { method = "setConversation"; payload = conversation!!; conversation = null }
        else if (context != null) { method = "setContext"; payload = context!!; context = null }
        else return
        rendering = true
        transcript.presentConversation(method == "setContext", payload)
    }
    override fun onCleared() { connectionNoticeJob?.cancel(); dictation.cancel(); captureFile?.delete(); stopPush(); stopNotificationOpen(); stopLock(); engine.destroy(); transcript.destroy(); changes.destroy() }
}
