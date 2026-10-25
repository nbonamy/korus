import SwiftUI

/// Missions the laptop is running or has finished, in the same surface as a conversation; the phone only follows them.
struct MissionsScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.missionPath) {
            let active = model.missions.filter(\.isActive)
            let completed = model.missions.filter { !$0.isActive }
            let attention = active.filter { $0.attentionCount > 0 }
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let first = attention.first { AttentionStrip(count: attention.reduce(0) { $0 + $1.attentionCount }, open: first.id) }
                    ForEach(active) { mission in
                        NavigationLink(value: mission.id) { MissionCard(mission: mission) }.buttonStyle(.plain)
                    }
                    if !completed.isEmpty {
                        Text("Completed").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12).padding(.horizontal, 4)
                        ForEach(completed) { mission in
                            NavigationLink(value: mission.id) { CompletedRow(mission: mission) }.buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            .overlay { if model.missions.isEmpty { ContentUnavailableView("No missions", systemImage: "target") } }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { model.drawerOpen.toggle() } label: { Image(systemName: "line.3.horizontal") }
                        .buttonBorderShape(.circle)
                        .accessibilityLabel("Agents")
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text("Missions").font(.headline)
                        if !active.isEmpty { Text("\(active.count) active").font(.caption).foregroundStyle(.secondary) }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }
            }
            .toolbarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { route in
                if route.hasPrefix("review:") {
                    ReviewScreen(missionID: String(route.dropFirst("review:".count)))
                } else if route.hasPrefix("finding:") {
                    let parts = route.dropFirst("finding:".count).split(separator: ":", maxSplits: 1).map(String.init)
                    if parts.count == 2 { FindingScreen(missionID: parts[0], findingID: parts[1]) }
                } else {
                    MissionDetailScreen(missionID: route)
                }
            }
        }
        .background(Color(.systemBackground).ignoresSafeArea())
    }
}

// MARK: Gauge

/// How far a mission has come: a ring that fills with accepted tickets, the count in its center, a check once everything is done.
private struct MissionGauge: View {
    let mission: MissionSummary
    var size: CGFloat = 64
    var lineWidth: CGFloat = 7

    private var tint: Color {
        if !mission.isActive { return .secondary }
        return mission.allTicketsDone ? .green : .accentColor
    }

    var body: some View {
        ZStack {
            Circle().stroke(tint.opacity(0.15), lineWidth: lineWidth)
            Circle().trim(from: 0, to: mission.progress)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if mission.tickets.isEmpty {
                Image(systemName: "ellipsis").font(.system(size: size * 0.3, weight: .semibold)).foregroundStyle(.secondary)
            } else if mission.allTicketsDone {
                Image(systemName: "checkmark").font(.system(size: size * 0.34, weight: .bold)).foregroundStyle(tint)
            } else {
                Text("\(mission.done)/\(mission.tickets.count)").font(.system(size: size * 0.27, weight: .semibold, design: .rounded)).foregroundStyle(.primary).minimumScaleFactor(0.7)
            }
        }
        .frame(width: size, height: size)
        .animation(.smooth, value: mission.progress)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(mission.done) of \(mission.tickets.count) tickets done")
    }
}

private struct PulsingDot: View {
    var color: Color = .accentColor
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7).opacity(dim ? 0.3 : 1)
            .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true } } }
            .accessibilityHidden(true)
    }
}

// MARK: List

private struct AttentionStrip: View {
    @Environment(AppModel.self) private var model
    let count: Int
    let open: String

    var body: some View {
        Button { model.missionPath = [open] } label: {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.circle.fill")
                Text(count == 1 ? "1 ticket needs you" : "\(count) tickets need you").font(.subheadline.weight(.medium))
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(.orange)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct MissionCard: View {
    let mission: MissionSummary

    var body: some View {
        HStack(spacing: 16) {
            MissionGauge(mission: mission)
            VStack(alignment: .leading, spacing: 6) {
                Text(mission.outcome).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                if mission.isReadyToShip {
                    Label("Ready to ship", systemImage: "checkmark.circle.fill").font(.caption.weight(.medium)).foregroundStyle(.green)
                } else if let now = mission.nowLine {
                    HStack(spacing: 6) { PulsingDot(); Text(now).lineLimit(1) }.font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(mission.stageLabel).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 20).padding(.vertical, 20)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct CompletedRow: View {
    let mission: MissionSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.secondary).font(.title3)
            Text(mission.outcome).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: Detail

private struct MissionDetailScreen: View {
    @Environment(AppModel.self) private var model
    let missionID: String

    var body: some View {
        if let mission = model.missions.first(where: { $0.id == missionID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    StageTracker(current: mission.stageIndex, finished: !mission.isActive)
                    Summary(mission: mission)
                    NextStep(mission: mission)
                    if let review = mission.review { ReviewRow(missionID: mission.id, review: review) }
                    if let lead = mission.leadAgentId { LeadRow(stage: mission.stageLabel, agentId: lead) }
                    if !mission.tickets.isEmpty { Timeline(mission: mission) }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            .navigationTitle("Mission")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Mission unavailable", systemImage: "target")
        }
    }
}

private struct StageTracker: View {
    let current: Int
    let finished: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(MissionSummary.stages.enumerated()), id: \.offset) { index, stage in
                let done = finished || index < current
                let isCurrent = !finished && index == current
                VStack(spacing: 6) {
                    ZStack {
                        HStack(spacing: 0) {
                            Rectangle().fill(index <= current || finished ? Color.green.opacity(index == current && !finished ? 0.35 : 1) : Color.secondary.opacity(0.25)).frame(height: 2).opacity(index == 0 ? 0 : 1)
                            Rectangle().fill(done ? Color.green : Color.secondary.opacity(0.25)).frame(height: 2).opacity(index == MissionSummary.stages.count - 1 ? 0 : 1)
                        }
                        Circle().fill(done ? Color.green : isCurrent ? Color.accentColor : Color(.systemBackground))
                            .overlay(Circle().stroke(done || isCurrent ? Color.clear : Color.secondary.opacity(0.4), lineWidth: 1.5))
                            .frame(width: 30, height: 30)
                        Image(systemName: done ? "checkmark" : stage.2).font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(done || isCurrent ? Color.white : Color.secondary)
                    }
                    Text(stage.1).font(.caption2).foregroundStyle(isCurrent ? Color.primary : Color.secondary).lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(stage.1), \(done ? "done" : isCurrent ? "current" : "to come")")
            }
        }
    }
}

private struct Summary: View {
    let mission: MissionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(mission.outcome).font(.subheadline.weight(.semibold))
            HStack(spacing: 16) {
                MissionGauge(mission: mission, size: 84, lineWidth: 9)
                VStack(alignment: .leading, spacing: 8) {
                    Text(mission.tickets.isEmpty ? mission.stageLabel : "\(mission.done) of \(mission.tickets.count) \(mission.tickets.count == 1 ? "ticket" : "tickets")")
                        .font(.title3.weight(.semibold))
                    HStack(spacing: 8) {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            if let seconds = mission.elapsed(now: context.date) { Chip(symbol: "clock", text: MissionSummary.elapsedText(seconds)) }
                        }
                        if mission.workingCount > 0 { Chip(symbol: "person.2", text: "\(mission.workingCount) working", tint: .accentColor) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// The one move a phone can make on a mission: on to review. Shipping stays on the desktop, and says so.
private struct NextStep: View {
    @Environment(AppModel.self) private var model
    let mission: MissionSummary
    @State private var confirming = false

    var body: some View {
        if mission.canContinueToReview {
            Button { confirming = true } label: {
                HStack {
                    if model.missionAction == "working" { ProgressView().tint(.white) }
                    Text("Continue to Review").font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity).padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent).buttonBorderShape(.roundedRectangle(radius: 16))
            .disabled(model.missionAction == "working")
            .confirmationDialog("Move this mission to review?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Continue to Review") { model.command("continueMission", ["missionId": mission.id]) }
            } message: { Text("Implementation is complete. The review starts right away.") }
        } else if mission.shipsOnDesktop {
            VStack(spacing: 6) {
                Button {} label: {
                    Label("Ship", systemImage: "lock").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.bordered).buttonBorderShape(.roundedRectangle(radius: 16)).disabled(true)
                Text("Only available on desktop").font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// The agent leading the mission is one tap away, for a question or a change of direction.
private struct LeadRow: View {
    @Environment(AppModel.self) private var model
    let stage: String
    let agentId: String

    var body: some View {
        Button { model.open(missionAgent: agentId) } label: {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.text.bubble.right").font(.title3).foregroundStyle(Color.accentColor).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Talk to the mission lead").font(.subheadline.weight(.medium))
                    Text(stage).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

private extension MissionReviewSummary {
    var headline: String {
        findings.isEmpty ? "No findings" : "\(findings.count) \(findings.count == 1 ? "finding" : "findings") · \(fixedCount) fixed"
    }
}

private func priorityTint(_ priority: String) -> Color {
    switch priority.lowercased() {
    case "p0", "p1": .red
    case "p2": .orange
    default: .secondary
    }
}

/// A way into what the review found.
private struct ReviewRow: View {
    let missionID: String
    let review: MissionReviewSummary

    var body: some View {
        NavigationLink(value: "review:\(missionID)") {
            HStack(spacing: 12) {
                Image(systemName: "checklist").font(.title3).foregroundStyle(Color.accentColor).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Review").font(.subheadline.weight(.medium))
                    Text(review.headline).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Review

/// The review's findings: choose what to fix, fix it, and review again once nothing is open.
private struct ReviewScreen: View {
    @Environment(AppModel.self) private var model
    let missionID: String
    @State private var confirming: Confirmation?
    private enum Confirmation: Identifiable { case fix, rerun; var id: Self { self } }

    var body: some View {
        if let mission = model.missions.first(where: { $0.id == missionID }), let review = mission.review {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ReviewSummaryCard(review: review)
                    ForEach(review.groups, id: \.priority) { group in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(group.priority).font(.caption.weight(.bold)).foregroundStyle(priorityTint(group.priority))
                                Text("· \(group.findings.count)").font(.caption.weight(.semibold)).foregroundStyle(priorityTint(group.priority))
                            }
                            .padding(.leading, 4)
                            VStack(spacing: 0) {
                                ForEach(Array(group.findings.enumerated()), id: \.element.id) { index, finding in
                                    FindingRow(missionID: missionID, finding: finding)
                                    if index < group.findings.count - 1 { Divider().padding(.leading, 52) }
                                }
                            }
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { actions(review) }
            .navigationTitle("Review")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Review unavailable", systemImage: "checklist")
        }
    }

    @ViewBuilder private func actions(_ review: MissionReviewSummary) -> some View {
        let working = model.missionAction == "working"
        VStack(spacing: 8) {
            if review.fixingCount > 0 {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Fixing \(review.fixingCount) \(review.fixingCount == 1 ? "finding" : "findings") — the agent is working on your laptop").font(.footnote).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 12) {
                    Button { confirming = .fix } label: {
                        Text(review.selectedCount > 0 ? "Fix \(review.selectedCount) selected" : "Fix selected").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.roundedRectangle(radius: 14))
                    .disabled(review.selectedCount == 0 || working)
                    Button("Re-run review") { confirming = .rerun }
                        .font(.subheadline.weight(.medium)).disabled(!review.canRerun || working)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.bar)
        .confirmationDialog(confirming == .fix ? "Fix \(review.selectedCount) \(review.selectedCount == 1 ? "finding" : "findings")?" : "Review again?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if confirming == .fix { Button("Fix selected") { model.command("fixFindings", ["missionId": missionID]) } }
            else { Button("Re-run review") { model.command("rerunReview", ["missionId": missionID]) } }
        } message: {
            Text(confirming == .fix ? "The other open findings are skipped." : "Every finding was fixed or skipped. The review starts right away.")
        }
    }
}

private struct ReviewSummaryCard: View {
    let review: MissionReviewSummary

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().stroke(Color.green.opacity(0.15), lineWidth: 7)
                Circle().trim(from: 0, to: review.progress).stroke(Color.green, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90))
                Text("\(review.fixedCount)/\(review.findings.count)").font(.system(size: 14, weight: .semibold, design: .rounded)).minimumScaleFactor(0.7)
            }
            .frame(width: 56, height: 56)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(review.fixedCount) of \(review.findings.count) fixed").font(.subheadline.weight(.semibold))
                Text("\(review.findings.count) \(review.findings.count == 1 ? "finding" : "findings") · \(review.selectedCount) selected").font(.caption).foregroundStyle(.secondary)
                if !review.summary.isEmpty { Text(review.summary).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct StateChip: View {
    let state: String

    private var label: String { state == "fixing" ? "Fixing" : state == "fixed" ? "Fixed" : state == "skipped" ? "Skipped" : "Open" }
    private var tint: Color { state == "fixed" ? .green : state == "fixing" ? .accentColor : state == "skipped" ? .secondary : .orange }

    var body: some View {
        HStack(spacing: 4) {
            if state == "fixing" { ProgressView().controlSize(.mini) }
            Text(label)
        }
        .font(.caption2.weight(.semibold)).foregroundStyle(tint)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(tint.opacity(0.12), in: Capsule())
    }
}

private struct FindingRow: View {
    @Environment(AppModel.self) private var model
    let missionID: String
    let finding: ReviewFindingSummary

    var body: some View {
        HStack(spacing: 12) {
            Button { model.command("selectFinding", ["missionId": missionID, "findingId": finding.id, "selected": !finding.selected]) } label: {
                Image(systemName: finding.selected ? "checkmark.circle.fill" : "circle").font(.title3)
                    .foregroundStyle(finding.selected ? Color.accentColor : Color.secondary.opacity(0.5)).frame(width: 40, height: 44)
            }
            .buttonStyle(.plain).disabled(!finding.isOpen || model.missionAction == "working")
            .opacity(finding.isOpen ? 1 : 0.35)
            .accessibilityLabel(finding.selected ? "Deselect \(finding.title)" : "Select \(finding.title)")
            NavigationLink(value: "finding:\(missionID):\(finding.id)") {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(finding.title).font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
                        Text([finding.location, finding.repository].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    StateChip(state: finding.state)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.trailing, 12).padding(.vertical, 6)
        .foregroundStyle(finding.state == "fixed" || finding.state == "skipped" ? .secondary : .primary)
    }
}

private struct FindingScreen: View {
    @Environment(AppModel.self) private var model
    let missionID: String
    let findingID: String

    var body: some View {
        if let finding = model.missions.first(where: { $0.id == missionID })?.review?.findings.first(where: { $0.id == findingID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        Text(finding.priorityLabel).font(.caption.weight(.bold)).foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(priorityTint(finding.priority), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        StateChip(state: finding.state)
                    }
                    Text(finding.title).font(.title3.weight(.semibold))
                    if let location = finding.location {
                        Label(location, systemImage: "doc.text").font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    Text(finding.body).font(.subheadline).textSelection(.enabled)
                }
                .padding(16)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if finding.isOpen {
                    Button { model.command("selectFinding", ["missionId": missionID, "findingId": finding.id, "selected": !finding.selected]) } label: {
                        Text(finding.selected ? "Remove from remediation" : "Select for remediation").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.roundedRectangle(radius: 14)).disabled(model.missionAction == "working")
                    .padding(.horizontal, 16).padding(.vertical, 12).background(.bar)
                }
            }
            .navigationTitle("\(finding.priorityLabel) finding")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Finding unavailable", systemImage: "checklist")
        }
    }
}

private struct Chip: View {
    let symbol: String
    let text: String
    var tint: Color = .secondary

    var body: some View {
        Label(text, systemImage: symbol).font(.caption.weight(.medium)).foregroundStyle(tint)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

/// The tickets in order along one line, so what is done, what is moving and what is waiting reads top to bottom.
private struct Timeline: View {
    let mission: MissionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tickets").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(mission.tickets.enumerated()), id: \.element.id) { index, ticket in
                    TicketRow(ticket: ticket, first: index == 0, last: index == mission.tickets.count - 1)
                }
            }
        }
    }
}

private struct TicketRow: View {
    @Environment(AppModel.self) private var model
    let ticket: MissionTicketSummary
    let first: Bool
    let last: Bool

    private var state: MissionTicketState { MissionTicketState(ticket.state) }
    private var tint: Color {
        switch state {
        case .accepted: .green
        case .failed: .red
        case .awaitingReview: .orange
        case .running, .preparing: .accentColor
        case .blocked, .queued, .cancelled: .secondary
        }
    }

    var body: some View {
        if let agentId = ticket.agentId {
            Button { model.open(missionAgent: agentId) } label: { row(chevron: true) }.buttonStyle(.plain)
        } else {
            row(chevron: false)
        }
    }

    private func row(chevron: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 2, height: 10).opacity(first ? 0 : 1)
                ZStack {
                    Circle().fill(tint.opacity(state == .queued || state == .blocked ? 0.1 : 0.16)).frame(width: 30, height: 30)
                    Image(systemName: state.symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(tint)
                }
                Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 2).frame(maxHeight: .infinity).opacity(last ? 0 : 1)
            }
            .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(String(format: "%02d", ticket.number)) \(ticket.title)").font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(state.label).foregroundStyle(state == .queued || state == .blocked || state == .accepted || state == .cancelled ? Color.secondary : tint)
                    if let after = ticket.after, !after.isEmpty {
                        Text("· after \(after.map { String(format: "%02d", $0) }.joined(separator: ", "))").foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
                if let activity = ticket.activity {
                    Text(activity).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .padding(.vertical, 8)
            Spacer(minLength: 0)
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).padding(.top, 14) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Under a ticket worker's header, only when its work waits for a person: say so and offer to accept it.
/// Otherwise nothing: a conversation shows no mission progress.
struct MissionContextBar: View {
    @Environment(AppModel.self) private var model
    @State private var confirming = false

    var body: some View {
        if let reference = model.workerMission, reference.lead != true, let mission = model.missions.first(where: { $0.id == reference.id }),
           let ticket = mission.tickets.first(where: { $0.agentId == model.activeAgentID }),
           ticket.runId != nil, MissionTicketState(ticket.state) == .awaitingReview {
            HStack(spacing: 12) {
                Text("Ready for your review").font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                Button("Accept") { confirming = true }
                    .font(.caption.weight(.semibold)).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.small)
                    .disabled(model.missionAction == "working")
                    .confirmationDialog("Accept this ticket?", isPresented: $confirming, titleVisibility: .visible) {
                        Button("Accept") { model.command("acceptTicket", ["missionId": mission.id, "number": ticket.number]) }
                    } message: { Text("It counts as done for the mission.") }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(.bar)
            .accessibilityElement(children: .contain)
        }
    }
}
