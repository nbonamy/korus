import SwiftUI

struct ActivityDrawerList: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let groups: [SidebarGroup]
    @State private var scrollAnchor: String?
    @State private var animateMoves = false

    private var items: [SidebarActivityItem] { SidebarActivityItem.project(groups) }
    private var visible: Bool { model.drawerOpen && scenePhase == .active }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                // A single ForEach preserves each agent's identity across section boundaries.
                ForEach(items) { item in
                    switch item {
                    case .header(let group):
                        ActivityHeader(group: group, reduceMotion: reduceMotion, animateSymbols: visible)
                            .padding(.top, 14).padding(.bottom, 3)
                            .padding(.horizontal, 14)
                            .transition(.opacity)
                    case .agent(let session):
                        Button { model.select(agent: session.agentId) } label: {
                            ActivitySessionRow(session: session, isActive: session.agentId == model.activeAgentID)
                        }
                        .buttonStyle(.plain)
                        .transition(.opacity)
                    }
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 10).padding(.bottom, 12)
        }
        .scrollPosition(id: $scrollAnchor, anchor: .top)
        .animation(visible && animateMoves && !reduceMotion ? .spring(response: 0.4, dampingFraction: 0.88) : nil, value: items.map(\.id))
        .task(id: visible) {
            animateMoves = false
            guard visible else { return }
            // Opening reveals the latest layout immediately; only subsequent live changes move.
            await Task.yield()
            guard !Task.isCancelled else { return }
            animateMoves = true
        }
    }
}

private struct ActivityHeader: View {
    let group: SidebarGroup
    let reduceMotion: Bool
    let animateSymbols: Bool

    private var color: Color {
        switch group.activity {
        case .attention: .purple
        case .working: .orange
        case .recent: .green
        default: .secondary
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Group {
                switch group.activity {
                case .attention:
                    Image(systemName: "bell.badge")
                        .symbolEffect(.wiggle, options: .repeat(.periodic(delay: 4)), isActive: animateSymbols && !reduceMotion)
                case .recent: Image(systemName: "checkmark.circle")
                case .working:
                    if reduceMotion { Image(systemName: "circle.dotted") }
                    else { ProgressView().controlSize(.mini).tint(color) }
                default: Image(systemName: "moon")
                }
            }
            .font(.system(size: 15, weight: .medium)).frame(width: 20, height: 20)
            Text(group.label).font(.subheadline.weight(.semibold))
            Spacer(minLength: 0)
        }
        .foregroundStyle(color)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct ActivitySessionRow: View {
    let session: SidebarSession
    let isActive: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: session.quickChat ? "bubble.left" : session.kind.symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(session.quickChat ? .secondary : session.kind.color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title).font(.body.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                if let subtitle = session.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if session.isUnread { UnreadDot() }
            if session.status == .error {
                Image(systemName: "exclamationmark.circle").foregroundStyle(.red).font(.caption)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(minHeight: 52, alignment: .leading)
        .background {
            if isActive { RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.secondarySystemFill)) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? .isSelected : [])
        .accessibilityValue(session.status.label + (session.isUnread ? ", unread" : ""))
    }
}
