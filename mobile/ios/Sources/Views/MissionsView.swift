import SwiftUI

/// Missions the laptop is running or has finished, in the same surface as a conversation; the phone only follows them.
struct MissionsScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.missionPath) {
            let active = model.missions.filter(\.isActive)
            let completed = model.missions.filter { !$0.isActive }
            List {
                if !active.isEmpty { section("Active", active) }
                if !completed.isEmpty { section("Completed", completed) }
            }
            .listStyle(.plain)
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

    private func section(_ title: String, _ missions: [MissionSummary]) -> some View {
        Section {
            ForEach(missions) { mission in
                NavigationLink(value: mission.id) { MissionRow(mission: mission) }
            }
        } header: {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
        }
    }
}

private struct MissionRow: View {
    let mission: MissionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(mission.outcome).font(.subheadline.weight(.medium)).lineLimit(2)
            Text(mission.summary).font(.footnote).foregroundStyle(.secondary)
            if !mission.tickets.isEmpty { MissionProgress(mission: mission) }
        }
        .foregroundStyle(mission.isActive ? .primary : .secondary)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct MissionProgress: View {
    let mission: MissionSummary

    var body: some View {
        ProgressView(value: mission.progress)
            .tint(mission.isActive ? .accentColor : .secondary)
            .scaleEffect(x: 1, y: 0.7, anchor: .center)
            .accessibilityHidden(true)
    }
}

private struct MissionDetailScreen: View {
    @Environment(AppModel.self) private var model
    let missionID: String

    var body: some View {
        if let mission = model.missions.first(where: { $0.id == missionID }) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(mission.outcome).font(.subheadline.weight(.medium))
                        Text(mission.summary).font(.footnote).foregroundStyle(.secondary)
                        if !mission.tickets.isEmpty { MissionProgress(mission: mission) }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }
                if !mission.tickets.isEmpty {
                    Section {
                        ForEach(mission.tickets) { ticket in TicketRow(ticket: ticket) }
                    } header: {
                        Text("Tickets").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Mission")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Mission unavailable", systemImage: "target")
        }
    }
}

private struct TicketRow: View {
    @Environment(AppModel.self) private var model
    let ticket: MissionTicketSummary

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
            Button { model.open(ticket: agentId) } label: { content(chevron: true) }
                .buttonStyle(.plain)
        } else {
            content(chevron: false)
        }
    }

    private func content(chevron: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: state.symbol).foregroundStyle(tint).font(.body).frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(String(format: "%02d", ticket.number)) \(ticket.title)").font(.subheadline).lineLimit(2)
                Text(state.label).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
