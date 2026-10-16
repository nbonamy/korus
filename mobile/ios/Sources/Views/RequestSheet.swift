import SwiftUI

struct RequestSheet: View {
    @Environment(AppModel.self) private var model
    let pending: PendingRequest
    @State private var draft = RequestDraft()
    private var busy: Bool { model.respondingRequest == pending.key }
    private var unavailable: Bool { busy || model.connection != .connected }

    var body: some View {
        NavigationStack {
            Group {
                if busy {
                    AppSheetProgress(title: "Sending your response", symbol: "paperplane",
                                     message: "Waiting for \(model.productName) to confirm the response.")
                } else { form }
            }
            .navigationTitle(busy ? "" : pending.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !busy {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { model.presentedRequest = nil }
                    }
                }
            }
        }
        .appSheetSurface()
        .interactiveDismissDisabled(busy)
        .presentationDetents(busy ? [.medium] : [.large])
        .presentationDragIndicator(busy ? .hidden : .visible)
    }

    private var form: some View {
        AppSheetList {
            if let group = pending.request.question {
                ForEach(group.questions) { question in
                    Section {
                        Text(question.question).font(.body)
                        ForEach(question.options ?? [], id: \.label) { option in
                            Button {
                                draft.toggle(option.label, for: question)
                                if question.multiSelect != true { draft.text[question.id] = "" }
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: draft.selections[question.id]?.contains(option.label) == true ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(option.label).foregroundStyle(.primary)
                                        if !option.description.isEmpty { Text(option.description).font(.subheadline).foregroundStyle(.secondary) }
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .accessibilityAddTraits(draft.selections[question.id]?.contains(option.label) == true ? .isSelected : [])
                        }
                        let answer = Binding(get: { draft.text[question.id] ?? "" }, set: { draft.text[question.id] = $0 })
                        if question.isSecret {
                            SecureField("Your answer", text: answer).textInputAutocapitalization(.never).autocorrectionDisabled()
                        } else {
                            TextField(question.options?.isEmpty == false ? "Or write your own answer" : "Your answer", text: answer, axis: .vertical)
                                .lineLimit(2...6)
                        }
                    } header: { Text(question.header) }
                }
                Section {
                    Button("Send Answer") {
                        if let answers = draft.answers(for: group.questions) { respond(["kind": "answered", "answers": answers]) }
                    }
                    .disabled(draft.answers(for: group.questions) == nil)
                    Button("Skip Question", role: .cancel) { respond(["kind": "cancelled"]) }
                }
            } else if let approval = pending.request.approval {
                Section {
                    Text(approval.title).font(.headline)
                    if let description = approval.description { Text(description) }
                    if let command = approval.command { code(command) }
                    if let cwd = approval.cwd { LabeledContent("Folder", value: cwd).font(.subheadline) }
                    ForEach(Array((approval.requestedPermissions ?? []).enumerated()), id: \.offset) { _, permission in
                        if permission.kind == "filesystem" {
                            LabeledContent(permission.access?.capitalized ?? "Files", value: permission.path ?? "")
                        } else {
                            LabeledContent("Network", value: permission.enabled == false ? "Disabled" : [permission.protocol, permission.host].compactMap { $0 }.joined(separator: ": "))
                        }
                    }
                }
                Section {
                    if approval.allowedScopes?.contains("once") != false { decision("Allow Once", "allow") }
                    if approval.allowedScopes?.contains("session") != false { decision("Allow for Session", "allow_conversation") }
                    if approval.canDeny != false { decision("Deny", "deny", destructive: true) }
                }
            } else if let confirmation = pending.request.confirmation {
                Section {
                    Text(confirmation.summary).font(.headline)
                    LabeledContent(confirmation.integrationName, value: confirmation.toolName)
                    code(confirmation.argumentsPreview)
                }
                Section {
                    decision("Allow Once", "allow")
                    if confirmation.allowConversation == true { decision("Allow for Conversation", "allow_conversation") }
                    if confirmation.allowAlways == true { decision("Always Allow", "always_allow") }
                    decision("Deny", "deny", destructive: true)
                }
            }
            if model.failedRequest == pending.key {
                Text("The response wasn’t confirmed. Your answer is still here. Check the connection and try again.")
                    .foregroundStyle(.red)
            }
            if model.connection != .connected { Text("Reconnect to the laptop to respond.").foregroundStyle(.secondary) }
        }
        .disabled(unavailable)
    }

    private func code(_ text: String) -> some View {
        Text(text).font(.system(.subheadline, design: .monospaced)).textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
    private func decision(_ label: String, _ value: String, destructive: Bool = false) -> some View {
        Button(label, role: destructive ? .destructive : nil) { respond(["kind": "decision", "decision": value]) }
    }
    private func respond(_ outcome: [String: Any]) {
        guard let reply = pending.reply(outcome: outcome) else { return }
        model.command("respondRequest", ["reply": reply])
    }
}
