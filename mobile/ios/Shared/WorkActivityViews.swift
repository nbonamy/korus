import SwiftUI
import WidgetKit

struct WorkActivityMark: View {
    var size: CGFloat = 22
    var body: some View {
        Image("brand-mark").resizable().renderingMode(.original).widgetAccentedRenderingMode(.fullColor)
            .scaledToFit().frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct WorkActivityLockScreen: View {
    let state: WorkActivityAttributes.ContentState
    let isStale: Bool
    var hostId: String? = nil
    var body: some View { WorkActivityContent(state: state, isStale: isStale, hostId: hostId).padding(16) }
}

struct WorkActivityContent: View {
    let state: WorkActivityAttributes.ContentState
    let isStale: Bool
    var hostId: String? = nil
    var spacing: CGFloat = 12
    private var hostName: String {
        state.hostName ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Companion")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            HStack(spacing: 10) {
                WorkActivityMark()
                HStack(spacing: 8) {
                    Text(hostName).lineLimit(1)
                    Spacer(minLength: 4)
                    if isStale { Text("Updates paused").fixedSize() }
                    else { Text("\(state.activeCount) \(state.activeCount == 1 ? "task" : "tasks")").fixedSize() }
                }.font(.caption).foregroundStyle(.secondary)
            }
            WorkActivityAgentRows(state: state, hostId: hostId, spacing: spacing)
        }
    }
}

struct WorkActivityAgentRows: View {
    let state: WorkActivityAttributes.ContentState
    var hostId: String? = nil
    var spacing: CGFloat = 12
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(state.agents.prefix(2)) { agent in
                if let hostId, let url = WorkActivityAttributes.link(hostId: hostId, agentId: agent.id) {
                    Link(destination: url) { row(agent) }.buttonStyle(.plain)
                        .accessibilityIdentifier("activity-thread-\(agent.id)")
                } else { row(agent) }
            }
        }
    }
    private func row(_ agent: WorkActivityAttributes.Agent) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                if agent.status == "idle" { Image(systemName: "checkmark").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary) }
                else { Color.clear }
            }.frame(width: 22, height: 18).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(agent.name).font(.subheadline.weight(agent.status == "idle" ? .regular : .semibold))
                        .foregroundStyle(agent.status == "idle" ? .secondary : .primary).lineLimit(1)
                    Spacer(minLength: 4)
                    if agent.status == "working", let startedAt = agent.startedAt {
                        Text(Date(timeIntervalSince1970: startedAt / 1000), style: .timer)
                            .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing).frame(width: 48)
                            .accessibilityIdentifier("activity-timer-\(agent.id)")
                    }
                }
                if agent.status != "idle" {
                    Text(detail(agent)).font(.caption).lineLimit(1)
                        .foregroundStyle(agent.status == "working" ? Color.secondary : agent.status == "error" ? Color.red : Color.orange)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }
    private func detail(_ agent: WorkActivityAttributes.Agent) -> String {
        switch agent.status {
        case "approval": "Approval required"
        case "question": "Response required"
        case "waiting": "Input required"
        case "error": "Needs attention"
        default: agent.detail
        }
    }
}
