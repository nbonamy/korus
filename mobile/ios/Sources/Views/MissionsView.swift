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
                LazyVStack(spacing: 12) {
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
            .navigationDestination(for: String.self) { MissionDetailScreen(missionID: $0) }
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
        return mission.isReadyToShip ? .green : .accentColor
    }

    var body: some View {
        ZStack {
            Circle().stroke(tint.opacity(0.15), lineWidth: lineWidth)
            Circle().trim(from: 0, to: mission.progress)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if mission.tickets.isEmpty {
                Image(systemName: "ellipsis").font(.system(size: size * 0.3, weight: .semibold)).foregroundStyle(.secondary)
            } else if mission.isReadyToShip {
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
        HStack(spacing: 14) {
            MissionGauge(mission: mission)
            VStack(alignment: .leading, spacing: 5) {
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
        .padding(14)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
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
            Button { model.open(ticket: agentId) } label: { row(chevron: true) }.buttonStyle(.plain)
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

/// Under a worker's header: which ticket this is and how the mission stands, so the conversation never loses its context.
struct MissionContextBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let reference = model.workerMission, let mission = model.missions.first(where: { $0.id == reference.id }),
           let ticket = mission.tickets.first(where: { $0.agentId == model.activeAgentID }) {
            VStack(spacing: 6) {
                HStack {
                    Text("Mission · ticket \(ticket.number) of \(mission.tickets.count) · \(MissionTicketState(ticket.state).label)").lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(mission.done)/\(mission.tickets.count)").monospacedDigit()
                }
                .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                ProgressView(value: mission.progress).scaleEffect(x: 1, y: 0.6, anchor: .center).tint(.accentColor)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(.bar)
            .accessibilityElement(children: .combine)
        }
    }
}
