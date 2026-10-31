import SwiftUI

/// Standalone reviews use the same finding hierarchy and compact action footer as Mission reviews.
struct CodeReviewLedgerView: View {
    @Environment(AppModel.self) private var app
    let details: CodeReviewDetails
    let session: CodeReviewDetails.Session
    @State private var roundID = ""
    @State private var confirmation: String?
    @State private var confirmedCommand: [String: Any]?
    @State private var questions: [String: String] = [:]
    private var round: CodeReviewDetails.Round? { session.rounds.first { $0.id == roundID } ?? session.rounds.last }
    private var available: Bool { app.connection == .connected && !["working", "unknown", "failed"].contains(app.reviewState.action ?? "") }
    private var canDecide: Bool { available && session.canDecide && round?.id == session.activeRoundId }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.statusLabel).font(.headline)
                        if let round { Text("Round \(round.number) · \(round.findings.count) \(round.findings.count == 1 ? "finding" : "findings")").font(.subheadline).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    if session.busy || session.status == "reviewing" || session.status == "fixing" { ProgressView() }
                }
                if session.rounds.count > 1 {
                    Picker("Review round", selection: $roundID) {
                        ForEach(session.rounds) { Text("Round \($0.number)").tag($0.id) }
                    }.pickerStyle(.menu)
                }
                if let reason = session.automation?.reason { Text(reason).font(.footnote).foregroundStyle(.secondary) }
                Button("Open reviewer conversation") { app.reviewOpen = false; app.select(agent: session.reviewerAgentId) }
                    .font(.subheadline)
                if let round {
                    if let error = round.error { Text(error).font(.subheadline).foregroundStyle(.red) }
                    if let summary = round.summary { Text(summary).font(.subheadline).textSelection(.enabled) }
                    if round.findings.isEmpty {
                        Text(session.status == "reviewing" ? "Findings will appear as the review progresses." : "No findings in this round.")
                            .foregroundStyle(.secondary).padding(.vertical, 16)
                    }
                    ForEach(["p0", "p1", "p2", "p3"], id: \.self) { priority in
                        let findings = round.findings.filter { $0.priority == priority }
                        if let first = findings.first {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    Text(first.priorityLabel).font(.subheadline.weight(.semibold))
                                    Text("\(findings.count)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                        .padding(.horizontal, 8).padding(.vertical, 3).background(Color(.secondarySystemBackground), in: Capsule())
                                }.accessibilityAddTraits(.isHeader)
                                VStack(spacing: 0) {
                                    ForEach(findings) { finding in
                                        findingRow(finding)
                                        if finding.id != findings.last?.id { Divider().padding(.leading, 44) }
                                    }
                                }.background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }
                }
            }.padding(16)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Refresh", systemImage: "arrow.clockwise") { app.command("loadReviewDetails") }
                    Button("Discard review", systemImage: "trash", role: .destructive) { confirm("discard") }.disabled(!available || session.automatic)
                } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Review options")
            }
        }
        .onChange(of: session.activeRoundId, initial: true) { _, value in roundID = value }
        .alert(confirmationTitle, isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })) {
            Button("Cancel", role: .cancel) { confirmation = nil }
            Button("Confirm", role: confirmation == "discard" ? .destructive : nil) {
                if available, let command = confirmedCommand { app.command("reviewAction", command) }; confirmation = nil
            }.disabled(!available)
        } message: { Text(confirmationMessage) }
    }

    private func findingRow(_ finding: CodeReviewDetails.Finding) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Button { send("decide", finding: finding.id, selected: !finding.selected) } label: {
                Image(systemName: finding.selected ? "checkmark.circle.fill" : "circle").font(.title3).frame(width: 32, height: 44)
            }
            .buttonStyle(.plain).disabled(!canDecide || finding.remediation.state == "fixed")
            .accessibilityLabel("Select \(finding.title)")
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 12) {
                    Text(finding.body).textSelection(.enabled)
                    if let evidence = finding.remediation.evidence { Text(evidence).foregroundStyle(.secondary).textSelection(.enabled) }
                    if let reason = finding.decision.reason { Text(reason).foregroundStyle(.secondary) }
                    ForEach(finding.discussion) { message in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(message.author == "user" ? "You" : "Reviewer").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Text(message.body).textSelection(.enabled)
                        }
                    }
                    if canDecide {
                        TextField("Ask about this finding", text: Binding(get: { questions[finding.id] ?? "" }, set: { questions[finding.id] = $0 }), axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                        Button("Ask reviewer") {
                            send("discuss", finding: finding.id, question: questions[finding.id]?.trimmingCharacters(in: .whitespacesAndNewlines))
                        }.disabled((questions[finding.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }.font(.subheadline).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(finding.title).font(.subheadline).foregroundStyle(.primary).multilineTextAlignment(.leading)
                    if let location = finding.location { Text(location.label).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    Text(finding.stateLabel).font(.caption.weight(.medium))
                        .foregroundStyle(finding.remediation.state == "fixed" ? Color.green : .secondary)
                }.padding(.vertical, 8)
            }
        }.padding(.horizontal, 12).padding(.vertical, 4)
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if app.reviewState.action == "unknown" || app.reviewState.action == "failed" {
                Text("Couldn’t confirm the latest review status.").font(.footnote).foregroundStyle(.secondary)
                Button("Refresh status") { app.command("loadReviewDetails") }
            }
            if app.reviewState.action == "working" { ProgressView() }
            if session.automatic {
                Button("Switch to manual") { confirm("manual") }.buttonStyle(.bordered).disabled(!available)
            } else if session.status == "ready" {
                Button { confirm("submit") } label: {
                    Text((session.rounds.first { $0.id == session.activeRoundId }?.selectedCount ?? 0) > 0 ? "Fix selected" : "Complete round")
                        .fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10)
                }.buttonStyle(.borderedProminent).disabled(!canDecide)
            } else if session.status == "readyToFinish" || session.status == "failed" {
                HStack(spacing: 12) {
                    if session.status == "readyToFinish" {
                        Button { confirm("finish") } label: { Text("Finish review").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10) }
                            .buttonStyle(.borderedProminent).disabled(!available || !session.canFinish)
                    }
                    Button { confirm("again") } label: { Text(session.status == "failed" ? "Retry review" : "Review again").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10) }
                        .buttonStyle(.bordered).disabled(!available || !session.canRerun)
                }
            }
        }.buttonBorderShape(.roundedRectangle(radius: 14))
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6).background(.bar)
    }
    private func send(_ action: String, finding: String? = nil, selected: Bool? = nil, question: String? = nil) {
        guard available, let command = details.command(action: action, findingID: finding, selected: selected, question: question) else { return }
        app.command("reviewAction", command)
    }
    private func confirm(_ action: String) {
        confirmedCommand = details.command(action: action)
        confirmation = action
    }
    private var confirmationTitle: String {
        switch confirmation { case "submit": "Submit this round?"; case "again": "Start another review round?"; case "finish": "Finish this review?"; case "manual": "Switch to manual review?"; default: "Discard this review?" }
    }
    private var confirmationMessage: String {
        switch confirmation {
        case "submit": "Selected findings will be fixed. Unselected findings will be skipped."
        case "again": "The reviewer will inspect the changes again, keeping earlier findings and decisions."
        case "finish": "Save the review report and close the review."
        case "manual": "The current operation can finish. You will choose subsequent fixes and rounds."
        default: "Close the review without saving a report. Code changes will be kept."
        }
    }
}
