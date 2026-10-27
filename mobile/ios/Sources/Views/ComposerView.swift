import SwiftUI
import UniformTypeIdentifiers

/// One quiet row until editing; the full composer stays open while it holds a draft.
struct ComposerView: View {
    @Environment(AppModel.self) private var model
    @State private var focused = false
    @State private var selection: NSRange?
    @State private var activeQuery: ComposerQuery?
    @State private var dismissedQuery: ComposerQuery?
    private struct PickerRequest: Identifiable {
        let token: ComposerDrafts.Import
        let source: AttachmentPicker.Source
        var id: UUID { token.id }
    }
    @State private var picker: PickerRequest?
    @State private var pickerImport: ComposerDrafts.Import?
    @State private var camera: ComposerDrafts.Import?
    @State private var cameraImport: ComposerDrafts.Import?
    private var canAttach: Bool {
        !model.goalMode && model.supportsAttachments && model.composerDrafts.target != nil && !model.composerDrafts.importing
            && !model.composerDrafts.sending && model.composerDrafts.items.count < ComposerDrafts.maxCount && !model.dictation.active
    }

    private var expanded: Bool { focused || model.goalMode || model.planMode || !model.composerDrafts.empty || model.dictation.active || model.composerDrafts.importing || model.composerDrafts.error != nil }
    private var primaryAction: ComposerDrafts.PrimaryAction { model.composerDrafts.primaryAction(isWorking: model.isWorking) }

    var body: some View {
        VStack(spacing: 6) {
            if let goal = model.goal, goal.status != "complete" { goalBar(goal.objective) }
            if model.goalError {
                Text("Goal change couldn’t be confirmed. Check its status before trying again.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 22)
            }
            if showSuggestions, let query = activeQuery {
                ComposerSuggestionsView(catalog: query.isSkill ? model.skills : model.mentions, query: query, select: { skill in
                    guard let result = ComposerChipText(text: model.composerText, chips: model.composerDrafts.chips).selecting(skill, at: query) else { return }
                    model.composerText = result.document.text
                    model.composerDrafts.chips = result.document.chips
                    selection = NSRange(location: result.caret, length: 0)
                    activeQuery = nil
                    focused = true
                }, dismiss: { dismissedQuery = query }, retry: { loadSuggestions() })
                .padding(.horizontal, 12)
            }
            if !model.queuedPrompts.isEmpty { queuedMessages }
            if model.queuedPromptFailed {
                Text("Queue change couldn’t be confirmed. Check the queue before trying again.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 22)
            }
            composer
        }
        .sheet(item: $picker, onDismiss: {
            if let request = pickerImport { model.composerDrafts.finishImport(request, attachments: []); pickerImport = nil }
        }) { request in
            AttachmentPicker(source: request.source, limit: ComposerDrafts.maxCount - model.composerDrafts.items.count,
                pickedPhotos: { providers in
                    pickerImport = nil; picker = nil
                    loadPhotos(providers, request: request.token)
                }, pickedFiles: { urls in
                    pickerImport = nil; picker = nil
                    loadFiles(urls, request: request.token)
                })
                .appSheetSurface()
        }
        .fullScreenCover(item: $camera, onDismiss: {
            if let request = cameraImport { model.composerDrafts.finishImport(request, attachments: []); cameraImport = nil }
        }) { request in
            CameraAttachmentView { image in
                cameraImport = nil; camera = nil
                guard let image else { model.composerDrafts.finishImport(request, attachments: []); return }
                Task {
                    do {
                        let attachment = try await Task.detached(priority: .userInitiated) { try AttachmentLoader.cameraPhoto(image) }.value
                        model.composerDrafts.finishImport(request, attachments: [attachment])
                    } catch { model.composerDrafts.finishImport(request, attachments: [], error: error.localizedDescription) }
                }
            }
        }
        .onChange(of: showSuggestions) { _, visible in if visible { loadSuggestions() } }
        .onChange(of: model.skills.status) { _, status in
            if status == .idle && activeQuery?.isSkill == true && showSuggestions { loadSuggestions() }
        }
        .onChange(of: model.mentions.status) { _, status in
            if status == .idle && activeQuery?.isSkill == false && showSuggestions { loadSuggestions() }
        }
        .onChange(of: activeQuery) { _, _ in
            dismissedQuery = nil
            if showSuggestions { loadSuggestions() }
        }
        .onChange(of: model.activeAgentID) { _, _ in selection = nil; activeQuery = nil; dismissedQuery = nil }
        .onChange(of: model.drawerOpen) { _, open in if open { focused = false } }
        .onChange(of: model.composerText) { _, text in if text.isEmpty { activeQuery = nil; selection = nil } }
    }

    private func loadSuggestions() {
        guard let query = activeQuery else { return }
        model.command(query.isSkill ? "loadSkills" : "loadMentions")
    }

    private var showSuggestions: Bool {
        focused && !model.drawerOpen && !model.dictation.active && model.connection == .connected
            && model.activeAgentID != nil && activeQuery != nil && activeQuery != dismissedQuery
    }

    private var composer: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 4) {
            if model.goalMode || model.planMode {
                HStack(spacing: 6) {
                    Label(model.goalMode ? "Goal" : "Plan", systemImage: model.goalMode ? "target" : "list.bullet.rectangle").font(.footnote.weight(.medium))
                    Spacer()
                    Button { if model.goalMode { model.setGoalMode(false) } else { model.setPlanMode(false) } } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(model.goalMode ? "Exit goal mode" : "Exit plan mode").disabled(model.composerDrafts.sending || model.goalBusy)
                }.padding(.horizontal, 10).padding(.top, 4)
            }
            ComposerAttachmentsView(drafts: model.composerDrafts) { item in
                focused = false
                model.presentedImage = ImagePreview(title: item.name, source: .data(item.data))
            }
            HStack(spacing: 6) {
                if !expanded { attachMenu }
                ComposerEditor(text: $model.composerText, chips: Binding(get: { model.composerDrafts.chips }, set: { model.composerDrafts.chips = $0 }), selection: $selection, focused: $focused,
                    query: $activeQuery, suggestions: model.skills.items + model.mentions.items, editable: !model.dictation.active && !model.composerDrafts.sending,
                    maxLines: expanded ? 8 : 1,
                    placeholder: model.goalMode ? "Describe your goal" : model.planMode ? "Describe what to plan" : model.composerSuggestion ?? "Message",
                    suggestedPrompt: model.composerSuggestion,
                    pastePhotos: canAttach ? { providers in
                        guard let request = model.composerDrafts.beginImport() else { return }
                        loadPhotos(providers, request: request)
                    } : nil)
                    .padding(.horizontal, 6)
                    .padding(.top, expanded ? 6 : 0)
                if !expanded {
                    micButton
                    if primaryAction != .send { sendButton }
                }
            }
            if expanded {
                HStack(spacing: 6) {
                    attachMenu
                    HStack(spacing: 0) {
                        serviceTierToggle
                        modelMenu
                    }
                    Spacer(minLength: 4)
                    micButton
                    sendButton
                }
            }
        }
        .padding(10)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 28, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        // Let iOS own keyboard dismissal. Animating this collapse independently
        // also animates the text field's width/height while it resigns focus.
        .animation(expanded ? .smooth(duration: 0.2) : nil, value: expanded)
        .alert("Dictation unavailable", isPresented: Binding(get: { model.dictation.error != nil }, set: { if !$0 { model.dictation.error = nil } })) {
            Button("OK", role: .cancel) { model.dictation.error = nil }
        } message: { Text(model.dictation.error ?? "") }
        .onDisappear { model.dictation.cancel() }
    }

    private var attachMenu: some View {
        @Bindable var model = model
        return Menu {
            Section {
                Button("Take Photo", systemImage: "camera") { openCamera() }.disabled(!canAttach)
                Button("Add Photos", systemImage: "photo.on.rectangle") { openPicker(.photos) }.disabled(!canAttach)
                Button("Add Files", systemImage: "paperclip") { openPicker(.files) }.disabled(!canAttach)
            }
            Section {
                if model.supportsGoals {
                    Toggle("Goal mode", systemImage: "target", isOn: Binding(get: { model.goalMode }, set: {
                        model.setGoalMode($0)
                        if model.goalMode { focused = true }
                    }))
                    .disabled(!model.canSend || !model.composerDrafts.items.isEmpty || model.composerDrafts.importing || model.composerDrafts.sending || model.dictation.active)
                }
                Toggle("Plan mode", systemImage: "list.bullet.rectangle", isOn: Binding(get: { model.planMode }, set: { model.setPlanMode($0) }))
                    .disabled(model.composerDrafts.sending || model.goalBusy)
                if !model.approvalPresets.isEmpty {
                    Menu("Permissions", systemImage: "shield") {
                        ForEach(model.approvalPresets, id: \.self) { preset in
                            Button { model.setApprovalPreset(preset) } label: {
                                Label(preset.replacingOccurrences(of: "-", with: " ").capitalized, systemImage: preset == model.approvalPreset ? "checkmark" : "")
                            }
                        }
                    }
                }
            }
            Section {
                Button("Review", systemImage: "checklist") { focused = false; model.openReview() }
                    .disabled(!model.canManageSession)
                Button("Delegate", systemImage: "arrow.triangle.branch") {
                    focused = false
                    model.command("delegate", ["startingContext": "handoff"])
                }.disabled(!model.canSend || model.composerDrafts.sending || model.composerDrafts.importing || model.dictation.active)
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(.primary)
                .frame(width: 38, height: 38)
                .contentShape(Circle())
        }
        .tint(.primary)
        .accessibilityLabel("Add")
    }

    private func goalBar(_ objective: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "target").foregroundStyle(.secondary)
            Text(objective).font(.footnote).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            if model.goalBusy { ProgressView().controlSize(.small) }
            Button { model.editGoal(); focused = true } label: { Image(systemName: "pencil").frame(width: 32, height: 36) }
                .accessibilityLabel("Edit goal")
                .disabled(!model.canSend || model.composerDrafts.sending || model.composerDrafts.importing || !model.composerDrafts.items.isEmpty)
            Button { model.clearGoal() } label: { Image(systemName: "xmark").frame(width: 32, height: 36) }
                .accessibilityLabel("Clear goal").disabled(!model.canSend || model.goalBusy)
        }
        .padding(.horizontal, 20)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Current goal")
    }

    @ViewBuilder
    private var serviceTierToggle: some View {
        if model.supportsServiceTier, let tier = model.selectedModel?.fastTier {
            let enabled = model.selectedServiceTier == tier.id
            Button { model.chooseServiceTier(enabled ? nil : tier.id) } label: {
                Image(systemName: enabled ? "bolt.fill" : "bolt")
                    .font(.system(size: 18, weight: .semibold))
                    .scaleEffect(x: 1.15, y: 0.78)
                    .foregroundStyle(enabled ? Color.primary : .secondary)
                    .frame(width: 32, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Fast mode")
            .accessibilityValue(enabled ? "On" : "Off")
            .accessibilityHint(enabled ? "Switch to Standard service tier." : "Switch to Fast service tier.")
        }
    }

    private var modelMenu: some View {
        @Bindable var model = model
        return Menu {
            Picker("Model", selection: Binding(get: { model.selectedModelID }, set: { if let id = $0 { model.chooseModel(id) } })) {
                ForEach(model.models) { choice in Text(choice.name).tag(Optional(choice.id)) }
            }
            if let efforts = model.selectedModel?.efforts, !efforts.isEmpty {
                Picker("Reasoning", selection: Binding(get: { model.selectedEffort }, set: { if let effort = $0 { model.chooseEffort(effort) } })) {
                    ForEach(efforts, id: \.self) { effort in Text(effort.capitalized).tag(Optional(effort)) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(model.selectedModel?.name ?? "Model")
                if let effort = model.selectedEffort { Text(effort.capitalized).foregroundStyle(.secondary) }
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(.primary)
            .padding(.leading, model.supportsServiceTier && model.selectedModel?.fastTier != nil ? 0 : 10)
            .padding(.trailing, 10).frame(height: 34)
            .contentShape(Capsule())
        }
        .tint(.primary)
    }

    private var micButton: some View {
        Button {
            if model.dictation.active { model.dictation.finish() }
            else {
                focused = false
                Task { await model.dictation.start(text: model.composerText) { model.composerText = $0 } }
            }
        } label: {
            Image(systemName: model.dictation.phase == .recording ? "stop.fill" : "mic")
                .font(.system(size: 22))
                .foregroundStyle(model.dictation.active ? Color.accentColor : .primary)
                .frame(width: 38, height: 38)
                .contentShape(Circle())
                .overlay {
                    if model.dictation.phase == .requesting || model.dictation.phase == .finishing {
                        ProgressView().controlSize(.mini).offset(x: 16, y: -16)
                    }
                }
        }
        .accessibilityLabel(model.dictation.active ? "Stop dictation" : "Dictate")
    }

    private func openCamera() {
        guard canAttach, let request = model.composerDrafts.beginImport() else { return }
        focused = false
        cameraImport = request
        camera = request
    }

    private func openPicker(_ source: AttachmentPicker.Source) {
        guard canAttach, let request = model.composerDrafts.beginImport() else { return }
        focused = false
        pickerImport = request
        picker = PickerRequest(token: request, source: source)
    }

    private func loadPhotos(_ providers: [NSItemProvider], request: ComposerDrafts.Import) {
        let images = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
        guard images.count <= ComposerDrafts.maxCount else {
            model.composerDrafts.finishImport(request, attachments: [], error: "You can attach up to 5 files or photos."); return
        }
        Task {
            do {
                var attachments: [ComposerAttachment] = []
                for provider in images { attachments.append(try await AttachmentLoader.photoProvider(provider)) }
                model.composerDrafts.finishImport(request, attachments: attachments)
            } catch { model.composerDrafts.finishImport(request, attachments: [], error: error.localizedDescription) }
        }
    }

    private func loadFiles(_ urls: [URL], request: ComposerDrafts.Import) {
        guard urls.count <= ComposerDrafts.maxCount else {
            model.composerDrafts.finishImport(request, attachments: [], error: "You can attach up to 5 files or photos."); return
        }
        Task {
            do {
                let attachments = try await Task.detached(priority: .userInitiated) { try urls.map { try AttachmentLoader.file($0) } }.value
                model.composerDrafts.finishImport(request, attachments: attachments)
            } catch { model.composerDrafts.finishImport(request, attachments: [], error: error.localizedDescription) }
        }
    }

    private var queuedMessages: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Queued · \(model.queuedPrompts.count)", systemImage: "tray")
                .font(.caption.weight(.medium)).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(model.queuedPrompts) { prompt in
                        HStack(spacing: 4) {
                            Text(prompt.text.replacingOccurrences(of: "\n", with: " "))
                                .font(.callout).lineLimit(1).truncationMode(.tail)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            queueButton("Steer", icon: "arrow.up", prompt: prompt, steer: true)
                            queueButton("Delete", icon: "trash", prompt: prompt, steer: false)
                        }
                        .frame(height: 44)
                        .overlay(alignment: .bottom) {
                            if prompt.id != model.queuedPrompts.last?.id { Divider() }
                        }
                    }
                }
            }
            .frame(height: CGFloat(min(model.queuedPrompts.count, 2)) * 44)
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color(.systemGroupedBackground), in: .rect(cornerRadius: 16))
        .padding(.horizontal, 16)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Queued messages")
    }

    private func queueButton(_ title: String, icon: String, prompt: EngineState.QueuedPrompt, steer: Bool) -> some View {
        Button { model.updateQueuedPrompt(prompt.id, steer: steer) } label: {
            Image(systemName: icon).font(.system(size: 15, weight: .medium))
                .foregroundStyle(steer ? Color.accentColor : Color.secondary)
                .frame(width: 32, height: 32)
                .background(steer ? Color.accentColor.opacity(0.1) : Color.secondary.opacity(0.08), in: .rect(cornerRadius: 9))
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!model.canManageSession || model.queuedPromptPending != nil)
        .opacity(model.queuedPromptPending == prompt.id ? 0.4 : 1)
        .accessibilityLabel("\(title) queued message: \(prompt.text)")
    }

    private var sendButton: some View {
        let empty = model.composerDrafts.empty
        let stopping = primaryAction == .stop
        let sending = primaryAction == .sending
        let choosing = model.isWorking && !model.goalMode && primaryAction == .send
        let mode = model.composerPreferences.followUpBehavior
        let disabled = sending || (stopping ? !model.canManageSession || !model.canInterrupt : empty || !model.canSend || model.composerDrafts.importing || (!model.supportsAttachments && !model.composerDrafts.items.isEmpty))
        let label = Group {
            if sending { ProgressView().tint(.white) }
            else { Image(systemName: stopping ? "stop.fill" : "arrow.up") }
        }
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(disabled && !sending ? Color.secondary.opacity(0.35) : Color.accentColor, in: .circle)
        return Group {
            if choosing {
                Menu {
                    Button("Steer", systemImage: "arrow.up") { focused = false; model.send(mode: .steer) }
                    Button("Queue", systemImage: "tray") { focused = false; model.send(mode: .queue) }
                } label: { label } primaryAction: {
                    focused = false; model.send()
                }
                .menuIndicator(.hidden)
                .menuOrder(.fixed)
            } else {
                Button {
                    if stopping { model.interrupt() }
                    else { focused = false; model.send() }
                } label: { label }
            }
        }
        .disabled(disabled)
        .animation(.smooth(duration: 0.2), value: primaryAction)
        .accessibilityLabel(sending ? "Sending" : stopping ? "Stop" : model.goalMode ? "Set goal" : choosing ? mode == .queue ? "Queue message" : "Steer agent" : "Send")
        .accessibilityHint(choosing ? "Touch and hold to choose Queue or Steer." : "")
    }
}
