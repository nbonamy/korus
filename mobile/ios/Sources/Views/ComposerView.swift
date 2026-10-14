import SwiftUI

/// One quiet row until editing; the full composer stays open while it holds a draft.
struct ComposerView: View {
    @Environment(AppModel.self) private var model
    @FocusState private var focused: Bool

    private var expanded: Bool { focused || !model.composerText.isEmpty || model.dictation.active }
    private var stopping: Bool { model.isWorking && model.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if !expanded { attachMenu }
                TextField("Message", text: $model.composerText, axis: .vertical)
                    .lineLimit(1...(expanded ? 8 : 1))
                    .focused($focused)
                    .disabled(model.dictation.active)
                    .font(.body)
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
        .animation(.smooth(duration: 0.2), value: expanded)
        .alert("Dictation unavailable", isPresented: Binding(get: { model.dictation.error != nil }, set: { if !$0 { model.dictation.error = nil } })) {
            Button("OK", role: .cancel) { model.dictation.error = nil }
        } message: { Text(model.dictation.error ?? "") }
        .onDisappear { model.dictation.cancel() }
    }

    private var attachMenu: some View {
        @Bindable var model = model
        return Menu {
            Section {
                Button("Add Photos", systemImage: "photo.on.rectangle") {}
                Button("Add Files", systemImage: "paperclip") {}
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
                Button("Review", systemImage: "checklist") {}
                Button("Delegate", systemImage: "arrow.triangle.branch") {}
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

    private var sendButton: some View {
        let empty = model.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let disabled = stopping ? !model.canManageSession || !model.canInterrupt : empty || !model.canSend
        return Button {
            if stopping { model.interrupt() }
            else { model.send(); focused = false }
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
