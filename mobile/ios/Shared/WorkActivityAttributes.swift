import ActivityKit
import Foundation

/// The same small payload is decoded by ActivityKit on the Lock Screen and Dynamic Island.
struct WorkActivityAttributes: ActivityAttributes {
    struct Agent: Codable, Hashable, Identifiable {
        let id: String
        let name: String
        let status: String
        let detail: String
        var backend: String? = nil
        var startedAt: Double? = nil
    }
    struct ContentState: Codable, Hashable {
        let running: Int
        let attention: Int
        var agents: [Agent] = []
        var more: Int = 0
        var hostName: String? = nil
        var active: Int? = nil

        var activeCount: Int { active ?? max(running, attention) }
        var singleTaskStartedAt: Double? {
            activeCount == 1 ? agents.first(where: { $0.status != "idle" })?.startedAt : nil
        }
    }
    let hostId: String
    let instanceId: String
    let startedAt: Double

    var url: URL? { Self.link(hostId: hostId) }

    static func link(hostId: String, agentId: String? = nil) -> URL? {
        var components = URLComponents()
        components.scheme = "companion-activity"
        components.host = "activity"
        components.queryItems = [URLQueryItem(name: "host", value: hostId)]
        if let agentId { components.queryItems?.append(URLQueryItem(name: "agent", value: agentId)) }
        return components.url
    }
}
