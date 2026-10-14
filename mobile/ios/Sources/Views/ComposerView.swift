import SwiftUI
import UniformTypeIdentifiers

/// One quiet row until editing; the full composer stays open while it holds a draft.
struct ComposerView: View {
    @Environment(AppModel.self) private var model
    @State private var focused = false
    @State private var selection: NSRange?
    @State private var activeQuery: SkillQuery?
    @State private var dismissedQuery: SkillQuery?
    private struct PickerRequest: Identifiable {
        let token: ComposerDrafts.Import
        let source: AttachmentPicker.Source
        var id: UUID { token.id }
    }
    @State private var picker: PickerRequest?
    @State private var pickerImport: ComposerDrafts.Import?
    private var canAttach: Bool {
        model.supportsAttachments && model.composerDrafts.target != nil && !model.composerDrafts.importing
            && !model.composerDrafts.sending && model.composerDrafts.items.count < ComposerDrafts.maxCount && !model.dictation.active
    }

    private var expanded: Bool { focused || !model.composerDrafts.empty || model.dictation.active || model.composerDrafts.importing || model.composerDrafts.error != nil }
    private var stopping: Bool { model.isWorking && model.composerDrafts.empty }

    var body: some View {
        VStack(spacing: 6) {
            if showSuggestions, let query = activeQuery {
                SkillSuggestionsView(catalog: model.skills, query: query, select: { skill in
                    guard let result = query.inserting(skill, into: model.composerText) else { return }
                    model.composerText = result.text
                    selection = NSRange(location: result.caret, length: 0)
                    activeQuery = nil
                    focused = true
                }, dismiss: { dismissedQuery = query }, retry: { model.command("loadSkills") })
                .padding(.horizontal, 12)
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
        }
        .onChange(of: showSuggestions) { _, visible in if visible { model.command("loadSkills") } }
        .onChange(of: model.skills.status) { _, status in
            if status == .idle && showSuggestions { model.command("loadSkills") }
        }
        .onChange(of: activeQuery) { _, _ in dismissedQuery = nil }
        .onChange(of: model.activeAgentID) { _, _ in selection = nil; activeQuery = nil; dismissedQuery = nil }
        .onChange(of: model.composerText) { _, text in if text.isEmpty { activeQuery = nil; selection = nil } }
    }

    private var showSuggestions: Bool {
        focused && !model.drawerOpen && !model.dictation.active && model.connection == .connected
            && model.activeAgentID != nil && activeQuery != nil && activeQuery != dismissedQuery
    }

    private var composer: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 4) {
            ComposerAttachmentsView(drafts: model.composerDrafts)
            HStack(spacing: 6) {
                if !expanded { attachMenu }
                SkillComposerEditor(text: $model.composerText, selection: $selection, focused: $focused,
                    query: $activeQuery, skills: model.skills.items, editable: !model.dictation.active && !model.composerDrafts.sending,
                    maxLines: expanded ? 8 : 1,
                    pastePhotos: canAttach ? { providers in
                        guard let request = model.composerDrafts.beginImport() else { return }
                        loadPhotos(providers, request: request)
                    } : nil)
                    .padding(.horizontal, 6)
                    .padding(.top, expanded ? 6 : 0)
                if !expanded {
                    micButton
                    if stopping { sendButton }
                }
            }
            if expanded {
                HStack(spacing: 6) {
                    attachMenu
                    modelMenu
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
                Button("Add Photos", systemImage: "photo.on.rectangle") { openPicker(.photos) }.disabled(!canAttach)
                Button("Add Files", systemImage: "paperclip") { openPicker(.files) }.disabled(!canAttach)
            }
            Section {
                Toggle("Plan mode", systemImage: "list.bullet.rectangle", isOn: Binding(get: { model.planMode }, set: { model.setPlanMode($0) }))
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
            .padding(.horizontal, 10).frame(height: 34)
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

    private var sendButton: some View {
        let empty = model.composerDrafts.empty
        let disabled = stopping ? !model.canManageSession || !model.canInterrupt : empty || !model.canSend || model.composerDrafts.importing || model.composerDrafts.sending || (!model.supportsAttachments && !model.composerDrafts.items.isEmpty)
        return Button {
            if stopping { model.interrupt() }
            else { focused = false; model.send() }
        } label: {
            Image(systemName: stopping ? "stop.fill" : "arrow.up")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(disabled ? Color.secondary.opacity(0.35) : Color.accentColor, in: .circle)
        }
        .disabled(disabled)
        .animation(.smooth(duration: 0.2), value: stopping)
        .accessibilityLabel(stopping ? "Stop" : "Send")
    }
}
