import ActivityKit
import Observation
import UIKit

/// Native ActivityKit lifecycle. The engine only signs and exchanges opaque tokens;
/// it never renders or keeps a background transcript alive for this feature.
@Observable @MainActor
final class WorkLiveActivities {
    var onRegistration: ((String, String, [String: Any]?) -> Void)?
    private(set) var registrationFailed = false
    private(set) var systemEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    var enabled: Bool {
        didSet {
            defaults.set(enabled, forKey: "liveActivities.enabled")
            if enabled { refresh() } else { disable() }
        }
    }
    private let defaults: UserDefaults
    private var hostId: String
    var selectedHost: String { hostId }
    private var startToken: Data?
    private var observed: [String: Task<Void, Never>] = [:]
    private var observers: [Task<Void, Never>] = []
    private var desired: [String: (host: String, registration: [String: Any]?)] = [:]
    private var acknowledged: [String: String] = [:]
    private var pending: [String: (slot: String, signature: String, lease: UIBackgroundTaskIdentifier)] = [:]
    private var trackedId: String?
    private var failedSlots = Set<String>()
    private var clears = Set<String>()
    private var renewedAt = Date.distantPast
    private let authorization = ActivityAuthorizationInfo()

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        enabled = defaults.object(forKey: "liveActivities.enabled") as? Bool ?? true
        hostId = defaults.string(forKey: "liveActivities.host") ?? ""
        clears = Set(defaults.stringArray(forKey: "liveActivities.clears") ?? [])
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        if defaults.string(forKey: "liveActivities.build") != build {
            // Installing an update can remove ActivityKit's instance while its
            // host-side update token still accepts pushes. Withdraw it once.
            if !hostId.isEmpty && !Activity<WorkActivityAttributes>.activities.contains(where: {
                $0.attributes.hostId == hostId && ($0.activityState == .active || $0.activityState == .stale)
            }) {
                clears.insert(hostId)
                defaults.set(Array(clears), forKey: "liveActivities.clears")
            }
            defaults.set(build, forKey: "liveActivities.build")
        }
        for id in clears { desired["\(id)/clear"] = (id, nil) }
        startToken = Activity<WorkActivityAttributes>.pushToStartToken
        observers.append(Task { [weak self] in
            for await token in Activity<WorkActivityAttributes>.pushToStartTokenUpdates {
                guard let self else { return }; self.startToken = token; self.refresh()
            }
        })
        observers.append(Task { [weak self] in
            for await activity in Activity<WorkActivityAttributes>.activityUpdates { self?.observe(activity) }
        })
        observers.append(Task { [weak self, authorization] in
            for await allowed in authorization.activityEnablementUpdates {
                guard let self else { return }; self.systemEnabled = allowed
                if allowed { self.refresh() } else { self.disable() }
            }
        })
    }

    func selectHost(_ id: String) {
        guard id != hostId else { return }
        clearHost(hostId)
        hostId = id; defaults.set(id, forKey: "liveActivities.host")
        trackedId = nil
        refresh()
    }

    func retainHosts(_ ids: Set<String>) {
        if !hostId.isEmpty && !ids.contains(hostId) { selectHost("") }
        desired = desired.filter { ids.contains($0.value.host) }
        clears = clears.intersection(ids)
        failedSlots = failedSlots.filter { desired[$0] != nil }
        registrationFailed = !failedSlots.isEmpty
        defaults.set(Array(clears), forKey: "liveActivities.clears")
    }

    func refresh(force: Bool = false) {
        failedSlots.removeAll()
        if force || Date().timeIntervalSince(renewedAt) >= 86400 {
            acknowledged.removeAll(); renewedAt = Date()
        }
        systemEnabled = authorization.areActivitiesEnabled
        guard enabled && systemEnabled else { disable(); return }
        if let token = startToken, !hostId.isEmpty {
            set("\(hostId)/start", host: hostId, registration: fields(token, kind: "start"))
        }
        for activity in Activity<WorkActivityAttributes>.activities { observe(activity) }
        retry()
    }

    private func observe(_ activity: Activity<WorkActivityAttributes>) {
        guard activity.activityState == .active || activity.activityState == .stale else { return }
        if let trackedId, !Activity<WorkActivityAttributes>.activities.contains(where: { $0.id == trackedId && ($0.activityState == .active || $0.activityState == .stale) }) {
            forget(trackedId)
        }
        guard enabled && systemEnabled && !hostId.isEmpty && activity.attributes.hostId == hostId else {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }; return
        }
        if let tracked = Activity<WorkActivityAttributes>.activities.first(where: { $0.id == trackedId }), tracked.id != activity.id {
            // Renewals supersede the prior instance; duplicate or delayed starts do not.
            guard activity.attributes.startedAt > tracked.attributes.startedAt else {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }; return
            }
            forget(tracked.id)
            Task { await tracked.end(nil, dismissalPolicy: .immediate) }
        }
        trackedId = activity.id
        if let token = activity.pushToken { register(token, for: activity) }
        guard observed[activity.id] == nil else { return }
        observed[activity.id] = Task { [weak self] in
            await withTaskGroup(of: Void.self) { group in
                group.addTask { @MainActor [weak self] in
                    for await token in activity.pushTokenUpdates { self?.register(token, for: activity) }
                }
                group.addTask { @MainActor [weak self] in
                    for await state in activity.activityStateUpdates {
                        if state == .ended || state == .dismissed {
                            self?.forget(activity.id); return
                        }
                    }
                }
                await group.next(); group.cancelAll()
            }
        }
    }

    private func register(_ token: Data, for activity: Activity<WorkActivityAttributes>) {
        guard activity.attributes.hostId == hostId, enabled, systemEnabled, activity.id == trackedId else { return }
        var registration = fields(token, kind: "update")
        registration["instanceId"] = activity.attributes.instanceId
        set("\(hostId)/update", host: hostId, registration: registration)
    }
    private func fields(_ token: Data, kind: String) -> [String: Any] {
        ["kind": kind, "token": token.map { String(format: "%02x", $0) }.joined(),
         "environment": Bundle.main.object(forInfoDictionaryKey: "CompanionPushEnvironment") as? String ?? "development"]
    }
    private func forget(_ id: String) {
        observed.removeValue(forKey: id)?.cancel()
        if trackedId == id { trackedId = nil; desired.removeValue(forKey: "\(hostId)/update") }
    }
    private func clearHost(_ id: String) {
        guard !id.isEmpty else { return }
        if desired["\(id)/start"] != nil || desired["\(id)/update"] != nil {
            acknowledged.removeValue(forKey: "\(id)/clear")
        }
        desired.removeValue(forKey: "\(id)/start"); desired.removeValue(forKey: "\(id)/update")
        acknowledged.removeValue(forKey: "\(id)/start"); acknowledged.removeValue(forKey: "\(id)/update")
        failedSlots.remove("\(id)/start"); failedSlots.remove("\(id)/update")
        clears.insert(id); defaults.set(Array(clears), forKey: "liveActivities.clears")
        set("\(id)/clear", host: id, registration: nil)
    }
    private func disable() {
        clearHost(hostId)
        for activity in Activity<WorkActivityAttributes>.activities { Task { await activity.end(nil, dismissalPolicy: .immediate) } }
        for task in observed.values { task.cancel() }; observed.removeAll(); trackedId = nil
    }
    private func set(_ slot: String, host: String, registration: [String: Any]?) {
        if signature(desired[slot]?.registration) != signature(registration) { failedSlots.remove(slot) }
        desired[slot] = (host, registration)
        retry()
    }
    private func signature(_ registration: [String: Any]?) -> String {
        (try? JSONSerialization.data(withJSONObject: registration as Any? ?? NSNull(), options: [.sortedKeys, .fragmentsAllowed]))?.base64EncodedString() ?? ""
    }
    private func retry() {
        guard let onRegistration, pending.isEmpty else { return }
        for slot in desired.keys.sorted(by: { ($0.hasSuffix("/clear") ? 0 : 1, $0) < ($1.hasSuffix("/clear") ? 0 : 1, $1) }) {
            guard let request = desired[slot] else { continue }
            let signature = signature(request.registration)
            guard acknowledged[slot] != signature, !failedSlots.contains(slot) else { continue }
            let id = UUID().uuidString
            let lease = UIApplication.shared.beginBackgroundTask(withName: "Register Live Activity") { [weak self] in self?.complete(id, success: false) }
            pending[id] = (slot, signature, lease)
            onRegistration(id, request.host, request.registration)
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                self?.complete(id, success: false)
            }
            break
        }
    }
    func complete(_ id: String, success: Bool) {
        guard let request = pending.removeValue(forKey: id) else { return }
        if request.lease != .invalid { UIApplication.shared.endBackgroundTask(request.lease) }
        guard let current = desired[request.slot], signature(current.registration) == request.signature else { retry(); return }
        if !success { failedSlots.insert(request.slot) }
        else { failedSlots.remove(request.slot) }
        registrationFailed = !failedSlots.isEmpty
        if success {
            acknowledged[request.slot] = request.signature
            if request.slot.hasSuffix("/clear"), let host = desired.removeValue(forKey: request.slot)?.host {
                clears.remove(host); defaults.set(Array(clears), forKey: "liveActivities.clears")
            }
        }
        retry()
    }
}
