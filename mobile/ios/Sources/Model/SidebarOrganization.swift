import Foundation

enum SidebarActivity: String, Codable, Sendable {
    case attention, recent, working, idle
}

enum SidebarOrganization: String, CaseIterable, Sendable {
    case activity, repository

    var label: String { self == .activity ? "Activity" : "Repository" }
}

enum SidebarIdleSort: String, CaseIterable, Sendable {
    case activity, repository

    var label: String { self == .activity ? "Recent activity" : "Repository" }
}

struct SidebarPreferences {
    var defaults: UserDefaults = .standard

    func organization(hostId: String, teamId: String) -> SidebarOrganization {
        defaults.string(forKey: key(hostId, teamId)).flatMap(SidebarOrganization.init(rawValue:)) ?? .activity
    }

    func setOrganization(_ organization: SidebarOrganization, hostId: String, teamId: String) {
        defaults.set(organization.rawValue, forKey: key(hostId, teamId))
    }

    func idleSort(hostId: String, teamId: String) -> SidebarIdleSort {
        defaults.string(forKey: "sidebar.idleSort:\(hostId):\(teamId)").flatMap(SidebarIdleSort.init(rawValue:)) ?? .activity
    }

    func setIdleSort(_ order: SidebarIdleSort, hostId: String, teamId: String) {
        defaults.set(order.rawValue, forKey: "sidebar.idleSort:\(hostId):\(teamId)")
    }

    private func key(_ hostId: String, _ teamId: String) -> String {
        "sidebar.organization:\(hostId):\(teamId)"
    }
}

/// One identity space lets SwiftUI move agents between groups instead of replacing them.
enum SidebarActivityItem: Identifiable, Equatable {
    case header(SidebarGroup)
    case agent(SidebarSession)

    var id: String {
        switch self {
        case .header(let group): "header:\(group.id)"
        case .agent(let session): "agent:\(session.agentId)"
        }
    }

    static func project(_ groups: [SidebarGroup]) -> [Self] {
        groups.filter { !$0.sessions.isEmpty }.flatMap { group in
            [.header(group)] + group.sessions.map(Self.agent)
        }
    }
}
