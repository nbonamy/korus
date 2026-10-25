import SwiftUI

struct DrawerView: View {
    @Environment(AppModel.self) private var model
    @State private var showingSettings = false
    @ScaledMetric(relativeTo: .subheadline) private var teamPillHeight: CGFloat = 36
    private static let mark = Bundle.main.url(forResource: "icon", withExtension: "png")
        .flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        VStack(spacing: 0) {
            teams
            organization
            missionsEntry
            if model.sidebarOrganization == .activity {
                ActivityDrawerList(groups: model.activityGroups)
                    .id("\(model.laptopID):\(model.sidebarScopeID)")
            } else {
                repositoryList
            }
            footer
        }
        .background(Color(.systemBackground))
        .fullScreenCover(isPresented: $showingSettings) { SettingsView() }
        .sheet(item: Binding(get: { model.newProjectSource }, set: { if $0 == nil { model.closeProjectSheet() } })) { source in
            NewProjectSheet(source: source)
        }
        .sheet(item: Binding(get: { model.newWorktreeGroup }, set: { if $0 == nil { model.closeWorktreeSheet() } })) { group in
            NewWorktreeSheet(group: group)
        }
        .sheet(item: Binding(get: { model.existingBranchGroup }, set: { if $0 == nil { model.closeBranchSheet() } })) { group in
            ExistingBranchSheet(group: group)
        }
        .alert(model.duplicateFailed ? "Couldn’t duplicate the agent" : "Couldn’t start the chat", isPresented: Binding(get: { model.chatCreation == .failed && model.newWorktreeGroup == nil && model.existingBranchGroup == nil && model.newProjectSource == nil }, set: { if !$0 { model.duplicateFailed = false; model.dismissChatFailure() } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Check the connection and try again.")
        }
    }

    @ViewBuilder private var missionsEntry: some View {
        if !model.missions.isEmpty {
            let active = model.missions.filter(\.isActive).count
            Button { model.showMissions() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "target").foregroundStyle(.secondary)
                    Text("Missions")
                    Spacer()
                    if active > 0 { Text("\(active) active").font(.subheadline).foregroundStyle(.secondary) }
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .font(.body)
                .padding(.horizontal, 24).frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(active > 0 ? "Missions, \(active) active" : "Missions")
        }
    }

    private var organization: some View {
        HStack {
            Menu {
                Picker("Agent view", selection: Binding(get: { model.sidebarOrganization }, set: model.chooseSidebarOrganization)) {
                    ForEach(SidebarOrganization.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(model.sidebarOrganization.label)
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Agent view: \(model.sidebarOrganization.label)")
            Spacer()
            if model.sidebarOrganization == .activity {
                Button { model.startQuickChat() } label: {
                    Group {
                        if model.creatingChatGroupID == AppModel.quickChatID { ProgressView().controlSize(.small) }
                        else { Image(systemName: "square.and.pencil") }
                    }
                    .frame(width: 44, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(!model.canStartChat || model.chatCreation == .creating)
                .accessibilityLabel("New chat")
            }
        }
        .padding(.leading, 24).padding(.trailing, 12)
    }

    private var repositoryList: some View {
        List {
            ForEach(model.groups) { group in
                Section {
                    ForEach(group.sessions) { session in
                        SessionRow(session: session, group: group, isActive: session.agentId == model.activeAgentID)
                            .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 10))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                model.select(agent: session.agentId)
                            }
                    }
                } header: {
                    GroupHeader(group: group)
                        .listRowInsets(.vertical, 0)
                }
                .listSectionMargins(.top, 12)
                .listSectionMargins(.bottom, 0)
            }
        }
        .listStyle(.plain)
        .listRowSpacing(4)
        .environment(\.defaultMinListRowHeight, 44)
        .scrollContentBackground(.hidden)
    }

    private var teams: some View {
        HStack(spacing: 12) {
            if let mark = Self.mark {
                Image(uiImage: mark)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 28, height: 28)
                    .clipShape(.rect(cornerRadius: 7, style: .continuous))
                    .accessibilityLabel(model.productName)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        if model.teams.count > 1 {
                            teamPill("All", selected: model.allTeams) { model.command("selectAllTeams") }
                                .accessibilityLabel("All teams")
                        }
                        ForEach(model.teams) { team in
                            let selected = !model.allTeams && team.id == model.teamID
                            teamPill(selected: selected, action: { model.select(team: team.id) }) {
                                HStack(spacing: 6) {
                                    Text(team.name)
                                    if team.isUnread == true && !selected { UnreadDot() }
                                }
                            }
                            .accessibilityLabel(team.name + (team.isUnread == true ? ", unread activity" : ""))
                        }
                        NewTeamButton(size: teamPillHeight)
                    }
                    .padding(.leading, 4).padding(.trailing, 20)
                    // Keep the glass inside the viewport vertically while clipping scrolled pills beside the fixed logo.
                    .padding(.vertical, 8)
                }
            }
        }
        .padding(.leading, 20)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }

    private func teamPill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        teamPill(selected: selected, action: action) { Text(title) }
    }

    private func teamPill<Label: View>(selected: Bool, action: @escaping () -> Void, @ViewBuilder label: () -> Label) -> some View {
        Button(action: action, label: label)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(height: teamPillHeight)
            .foregroundStyle(selected ? Color.white : Color.primary)
            .glassEffect(selected ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .capsule)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Said only when something is wrong; a healthy link needs no words.
            if model.showConnectionLost {
                ConnectionLostNotice(reconnect: model.reconnect)
            }
            HStack(spacing: 10) {
                NewAgentMenu(enabled: model.canStartChat && model.chatCreation != .creating,
                             quickChat: model.startQuickChat, select: model.openProject)
                Spacer()
                Button { showingSettings = true } label: {
                    Image(systemName: "gearshape").font(.body.weight(.semibold)).frame(width: 40, height: 40)
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }
}

private struct NewTeamButton: View {
    @Environment(AppModel.self) private var model
    @State private var showingPrompt = false
    @State private var name = ""
    let size: CGFloat
    private var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Button {
            if model.teamCreation != .failed { name = "" }
            showingPrompt = true
        } label: {
            Group {
                if model.teamCreation == .creating { ProgressView().controlSize(.small) }
                else { Image(systemName: "plus").font(.subheadline.weight(.semibold)) }
            }
            .frame(width: size, height: size)
            .glassEffect(.regular.interactive(), in: .circle)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.connection != .connected || model.teamCreation == .creating)
        .accessibilityLabel("New team")
        .alert("New Team", isPresented: $showingPrompt) {
            TextField("Name", text: $name)
            Button("Create") { model.command("createTeam", ["name": cleanName]) }
                .disabled(cleanName.isEmpty || cleanName.utf16.count > 100 || model.connection != .connected)
            Button("Cancel", role: .cancel) { model.command("dismissTeamCreation") }
        } message: {
            if model.teamCreation == .failed { Text("Couldn’t create the team. Check the connection and try again.") }
        }
        .onChange(of: model.teamCreation) { _, phase in
            if phase == .failed { showingPrompt = true }
        }
    }
}

private struct GroupHeader: View {
    @Environment(AppModel.self) private var model
    let group: SidebarGroup

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                GroupIcon(group: group)
                Text(group.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(nil)
            }
            // Compensate optically for the bubble's smaller visible bounds.
            .offset(y: group.kind == .quickChats ? 3 : 0)
            Spacer(minLength: 8)
            if model.canStartChat {
                if group.hasQuickChats {
                    Button { model.startQuickChat() } label: {
                        Group {
                            if model.creatingChatGroupID == AppModel.quickChatID { ProgressView().controlSize(.small) }
                            else { Image(systemName: "plus").font(.subheadline.weight(.semibold)) }
                        }
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .disabled(model.chatCreation == .creating)
                    .accessibilityLabel("New chat")
                } else if group.repositoryId != nil { newChatMenu }
            }
        }
        .padding(.leading, 6)
    }

    private var newChatMenu: some View {
        Menu {
            Button("Default Branch", systemImage: "arrow.triangle.merge") { model.startChat(in: group) }
            Button("Existing Branch…", systemImage: "arrow.triangle.branch") { model.existingBranchGroup = group }
            Button("New Worktree…", systemImage: "plus.square.on.square") { model.newWorktreeGroup = group }
        } label: {
            Group {
                if model.creatingChatGroupID == group.id && model.newWorktreeGroup == nil && model.existingBranchGroup == nil { ProgressView().controlSize(.small) }
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
            if let data = group.imageIconData, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(width: 24, height: 24)
            } else if let icon = group.icon, !icon.isEmpty, !icon.hasPrefix("data:image/") {
                Text(icon).font(.system(size: 15, weight: group.usesIconBadge ? .semibold : .regular))
                    .frame(width: 24, height: 24)
            } else if group.kind == .quickChats {
                Image(systemName: "bubble.left")
                    .font(.system(size: 17))
                    .frame(width: 24, height: 24)
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "folder")
                    .font(.system(size: 14))
                    .frame(width: 24, height: 24)
                    .foregroundStyle(.secondary)
            }
        }
        .background {
            if group.usesIconBadge {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(.quaternary)
                    .overlay {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .strokeBorder(.secondary.opacity(0.3), lineWidth: 0.5)
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
        HStack(spacing: 8) {
            if group.kind == .repository {
                Image(systemName: session.kind.symbol)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(session.kind.color)
                    .frame(width: 24)
            }
            Text(session.title)
                .font(.body)
                .lineLimit(1)
            Spacer(minLength: 8)
            if session.isUnread { UnreadDot() }
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

struct UnreadDot: View {
    var body: some View {
        Circle().fill(Color.red).frame(width: 8, height: 8).accessibilityLabel("Unread activity")
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
