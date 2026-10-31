import SwiftUI
import ActivityKit

@main struct LiveActivityFixture: App {
    @State private var controller = WorkLiveActivities(defaults: UserDefaults(suiteName: "live-activity-fixture")!)
    @State private var count = 0
    @State private var error = ""
    @State private var approval = false
    @State private var openedAgent = "none"
    @State private var activeRunning = 0
    @State private var upgradeRecovery = "Not checked"
    @State private var originalInstance = UUID().uuidString
    @State private var originalStart = Date().timeIntervalSince1970 * 1000
    private var crowded: Bool { ProcessInfo.processInfo.arguments.contains("--crowded") }
    private var workState: WorkActivityAttributes.ContentState {
        .init(running: crowded ? 3 : approval ? 0 : 1, attention: approval ? 1 : 0, agents: [
            .init(id: "main", name: "main", status: approval ? "approval" : "working", detail: "Debugging screenshot visibility", backend: "codex", startedAt: originalStart - 74_000),
            .init(id: "mobile", name: "mobile", status: crowded ? "working" : "idle", detail: crowded ? "Refining Live Activity rows" : "Completing Live Activity delivery", backend: "codex", startedAt: originalStart - 19_000)
        ], more: crowded ? 1 : 0, hostName: "Nicolas-MacBook-Pro.local", active: crowded ? 3 : 1)
    }
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 24) {
                WorkActivityLockScreen(state: workState, isStale: false, hostId: "fixture-host")
                    .padding().background(.black).foregroundStyle(.white).environment(\.colorScheme, .dark)
                Text("Active activities: \(count)").accessibilityIdentifier("activity-count")
                Text("Selected: \(controller.selectedHost.isEmpty ? "none" : controller.selectedHost)").accessibilityIdentifier("selected-host")
                Text("Active running: \(activeRunning)").accessibilityIdentifier("active-running")
                Text(error)
                Text("Opened: \(openedAgent)")
                Text(upgradeRecovery).accessibilityIdentifier("upgrade-recovery")
                Button("Check upgrade recovery") {
                    Task {
                        let suite = "live-activity-upgrade-fixture"
                        let defaults = UserDefaults(suiteName: suite)!
                        defaults.removePersistentDomain(forName: suite)
                        defaults.set("fixture-host", forKey: "liveActivities.host")
                        defaults.set("older-build", forKey: "liveActivities.build")
                        var withdrawals = 0
                        @MainActor func restored() -> WorkLiveActivities {
                            let restored = WorkLiveActivities(defaults: defaults)
                            restored.onRegistration = { [weak restored] id, _, registration in
                                if registration == nil { withdrawals += 1 }
                                restored?.complete(id, success: true)
                            }
                            restored.refresh()
                            return restored
                        }
                        controller = restored()
                        let active = withdrawals
                        for activity in Activity<WorkActivityAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
                        defaults.set("older-build", forKey: "liveActivities.build")
                        controller = restored()
                        let missing = withdrawals
                        defaults.set(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1", forKey: "liveActivities.build")
                        controller = restored()
                        upgradeRecovery = "Upgrade recovery: active=\(active) missing=\(missing) restart=\(withdrawals)"
                    }
                }
                Button("Start duplicate activities") {
                    Task {
                        controller.enabled = true
                        controller.selectHost("fixture-host")
                        originalInstance = UUID().uuidString
                        originalStart = Date().timeIntervalSince1970 * 1000
                        for _ in 0..<2 {
                            do {
                                _ = try Activity.request(attributes: WorkActivityAttributes(hostId: "fixture-host", instanceId: originalInstance, startedAt: originalStart),
                                    content: ActivityContent(state: workState, staleDate: Date().addingTimeInterval(900)), pushType: nil)
                            } catch { self.error = String(describing: error) }
                        }
                        controller.refresh()
                    }
                }
                Button("Renew activity") {
                    Task {
                        do {
                            approval = true
                            let renewed = WorkActivityAttributes.ContentState(running: 5, attention: workState.attention, agents: workState.agents, more: workState.more, hostName: workState.hostName, active: 1)
                            _ = try Activity.request(attributes: WorkActivityAttributes(hostId: "fixture-host", instanceId: UUID().uuidString, startedAt: originalStart + 1),
                                content: ActivityContent(state: renewed, staleDate: Date().addingTimeInterval(900)), pushType: nil)
                            // A delayed retry of the old start must not replace the renewal.
                            _ = try Activity.request(attributes: WorkActivityAttributes(hostId: "fixture-host", instanceId: originalInstance, startedAt: originalStart),
                                content: ActivityContent(state: workState, staleDate: Date().addingTimeInterval(900)), pushType: nil)
                        } catch { self.error = String(describing: error) }
                        controller.refresh()
                    }
                }
                Button("Switch laptop") { controller.selectHost("second-host") }
                Button("Forget laptop") { controller.retainHosts([]) }
                Toggle("Live Activities", isOn: Binding(get: { controller.enabled }, set: { controller.enabled = $0 }))
            }
            .padding()
            .onOpenURL { url in
                openedAgent = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "agent" })?.value ?? "none"
            }
            .task {
                controller.enabled = false
                try? await Task.sleep(for: .milliseconds(500))
                controller.enabled = true
                while !Task.isCancelled {
                    let active = Activity<WorkActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
                    count = active.count
                    activeRunning = active.first?.content.state.running ?? 0
                    try? await Task.sleep(for: .milliseconds(150))
                }
            }
        }
    }
}
