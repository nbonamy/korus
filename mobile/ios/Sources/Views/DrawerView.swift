import SwiftUI

struct DrawerView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            header
            teams
            newChatButton
            List {
                ForEach(model.groups) { group in
                    Section {
                        ForEach(group.sessions) { session in
                            SessionRow(session: session, group: group, isActive: session.agentId == model.activeAgentID)
                                .listRowInsets(EdgeInsets(top: 2, leading: 10, bottom: 2, trailing: 10))
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    withAnimation(.smooth(duration: 0.2)) {
                                        model.select(agent: session.agentId)
                                    }
                                }
                        }
                    } header: {
                        GroupHeader(group: group)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            footer
        }
        .background(Color(.systemBackground))
        .sheet(item: Binding(get: { model.newWorktreeGroup }, set: { if $0 == nil { model.closeWorktreeSheet() } })) { group in
            NewWorktreeSheet(group: group)
        }
        .alert("Couldn’t start the chat", isPresented: Binding(get: { model.chatCreation == .failed && model.newWorktreeGroup == nil }, set: { if !$0 { model.dismissChatFailure() } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Check the connection and try again.")
        }
    }

    private var header: some View {
        HStack {
            Text(model.productName)
                .font(.title2.weight(.bold))
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private var teams: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(model.teams) { team in
                        Button(team.name) { model.select(team: team.id) }
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .foregroundStyle(team.id == model.teamID ? Color.white : Color.primary)
                            .glassEffect(team.id == model.teamID ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .capsule)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 8)
    }

    /// The one entry point for a conversation that isn't about a repository: a plain link, like a row in the list.
    private var newChatButton: some View {
        Button { model.startQuickChat() } label: {
            HStack(spacing: 12) {
                Group {
                    if model.creatingChatGroupID == AppModel.quickChatID { ProgressView().controlSize(.small) }
                    else { Image(systemName: "square.and.pencil").font(.system(size: 17, weight: .medium)) }
                }
                .frame(width: 22)
                Text("New Chat").font(.body.weight(.medium))
                Spacer()
            }
            .padding(.horizontal, 22).frame(height: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.accentColor)
        .disabled(!model.canStartChat || model.chatCreation == .creating)
        .opacity(model.canStartChat ? 1 : 0.4)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Circle().fill(model.connection.color).frame(width: 9, height: 9)
            Text(model.connection.label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Menu {
                if model.connection == .connected { Button("Disconnect", systemImage: "wifi.slash") { model.disconnect() } }
                else { Button("Reconnect", systemImage: "arrow.clockwise") { model.reconnect() } }
                Button("Forget laptop", systemImage: "trash", role: .destructive) { model.forget() }
                Divider()
                Button("Debug", systemImage: "ladybug") {}
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.semibold)).frame(width: 40, height: 40)
                    .glassEffect(.regular.interactive(), in: .circle)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

private struct GroupHeader: View {
    @Environment(AppModel.self) private var model
    let group: SidebarGroup

    var body: some View {
        HStack(spacing: 8) {
            GroupIcon(group: group)
            Text(group.label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(nil)
            Spacer(minLength: 8)
            if group.repositoryId != nil, model.canStartChat { newChatMenu }
        }
        .padding(.leading, 10)
    }

    private var newChatMenu: some View {
        Menu {
            Button("Default Branch", systemImage: "arrow.triangle.merge") { model.startChat(in: group) }
            Button("New Worktree…", systemImage: "arrow.triangle.branch") { model.newWorktreeGroup = group }
        } label: {
            Group {
                if model.creatingChatGroupID == group.id && model.newWorktreeGroup == nil { ProgressView().controlSize(.small) }
                else { Image(systemName: "plus").font(.subheadline.weight(.semibold)) }
            }
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .foregroundStyle(.secondary)
        .disabled(model.chatCreation == .creating)
        .accessibilityLabel("New chat in \(group.label)")
    }
}

struct GroupIcon: View {
    let group: SidebarGroup

    var body: some View {
        Group {
            if let icon = group.icon, !icon.isEmpty {
                Text(icon).font(.system(size: 15))
                    .frame(width: 24, height: 24)
            } else {
                Image(systemName: group.kind == .quickChats ? "bubble.left" : "folder")
                    .font(.system(size: 14))
                    .frame(width: 24, height: 24)
                    .foregroundStyle(.secondary)
                    .background {
                        if group.kind != .quickChats {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(.quaternary)
                        }
                    }
            }
        }
    }
}

private struct SessionRow: View {
    let session: SidebarSession
    let group: SidebarGroup
    let isActive: Bool

    var body: some View {
        HStack(spacing: 12) {
            if group.kind == .repository {
                Image(systemName: session.kind.symbol)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(session.kind.color)
                    .frame(width: 22)
            }
            Text(session.title)
                .font(.body)
                .lineLimit(1)
            Spacer(minLength: 8)
            StatusDot(status: session.status)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background {
            if isActive {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemFill))
            }
        }
    }
}

struct StatusDot: View {
    let status: AgentStatus

    var body: some View {
        switch status {
        case .idle:
            EmptyView()
        case .working:
            ProgressView().controlSize(.small)
        case .awaitingInput:
            Capsule().fill(Color.orange.opacity(0.18)).overlay(Text("Input").font(.caption2.weight(.semibold)).foregroundStyle(.orange)).frame(width: 46, height: 20)
        case .error:
            Circle().fill(Color.red).frame(width: 9, height: 9)
        }
    }
}

extension SessionKind {
    var symbol: String { self == .worktree ? "arrow.triangle.branch" : "arrow.triangle.merge" }
    var color: Color {
        switch self {
        case .main: .blue
        case .branch: .green
        case .worktree: .orange
        case .detached, .folder: .secondary
        }
    }
}

extension ConnectionState {
    var label: String {
        switch self {
        case .unpaired: "Not connected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .disconnected: "Disconnected"
        case .reconnecting: "Reconnecting…"
        case .revoked: "Laptop forgotten"
        case .error: "Connection failed"
        }
    }
    var color: Color {
        switch self {
        case .connected: .green
        case .connecting, .reconnecting: .orange
        case .error: .red
        default: .secondary
        }
    }
}
