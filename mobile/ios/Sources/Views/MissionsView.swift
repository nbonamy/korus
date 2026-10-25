import SwiftUI

/// Missions the laptop is running or has finished; the phone only follows them.
struct MissionsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.missionPath) {
            AppSheetList {
                let active = model.missions.filter(\.isActive)
                let completed = model.missions.filter { !$0.isActive }
                if !active.isEmpty { section(nil, active) }
                if !completed.isEmpty { section("Completed", completed) }
            }
            .navigationTitle("Missions")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { MissionDetailView(missionID: $0) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { model.showingMissions = false } } }
        }
        .appSheetSurface()
    }

    private func section(_ title: String?, _ missions: [MissionSummary]) -> some View {
        Section {
            ForEach(missions) { mission in
                NavigationLink(value: mission.id) { MissionRow(mission: mission) }
            }
        } header: {
            if let title { Text(title) }
        }
    }
}

private struct MissionRow: View {
    let mission: MissionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(mission.outcome).font(.body).lineLimit(2)
            Text(mission.summary).font(.subheadline).foregroundStyle(.secondary)
            if !mission.tickets.isEmpty { ProgressView(value: mission.progress).tint(mission.isActive ? .accentColor : .secondary) }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct MissionDetailView: View {
    @Environment(AppModel.self) private var model
    let missionID: String

    var body: some View {
        if let mission = model.missions.first(where: { $0.id == missionID }) {
            AppSheetList {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(mission.outcome).font(.headline)
                        Text(mission.summary).font(.subheadline).foregroundStyle(.secondary)
                        if !mission.tickets.isEmpty { ProgressView(value: mission.progress).tint(mission.isActive ? .accentColor : .secondary) }
                    }
                    .padding(.vertical, 4)
                }
                if !mission.tickets.isEmpty {
                    Section("Tickets") {
                        ForEach(mission.tickets) { ticket in TicketRow(ticket: ticket) }
                    }
                }
            }
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
            Image(systemName: state.symbol).foregroundStyle(tint).font(.title3).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(String(format: "%02d", ticket.number)) \(ticket.title)").font(.body).lineLimit(2)
                Text(state.label).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
