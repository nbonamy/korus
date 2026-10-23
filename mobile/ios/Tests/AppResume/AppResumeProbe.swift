import SwiftUI
import Observation

// The production app/scene composition runs with an authenticated phone and a retained
// conversation. AppLockTests own the real authentication and grace-period transitions.
@MainActor final class CompanionAppDelegate: NSObject, UIApplicationDelegate {}

@Observable @MainActor final class AppLock {
    var isLocked = false
    var isAuthenticating = false
    var isProtecting = true
    func unlock() async {}
    func didLeave() {}
    func didReturn() {}
}

@Observable @MainActor final class AppModel {
    let productName = "Korus"
    private var executionEvents: [String] = []
    @ObservationIgnored private lazy var execution = StreamBackgroundExecution { [weak self] event in self?.executionEvents.append(event) }
    init() {
        _ = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { self.record("coverVisibleBeforeForeground") }
        }
    }
    func setUnlocked(_ unlocked: Bool) {}
    func setActive(_ active: Bool) {
        execution.update(working: true, foreground: active)
        if active { record("coverVisibleOnResume") }
    }

    private func record(_ key: String) {
        let covers = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { $0 is AppLockWindow && !$0.isHidden }.count
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("resume.json")
        var result = ((try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        result[key] = covers > 0
        result["executionEvents"] = executionEvents
        result["pid"] = ProcessInfo.processInfo.processIdentifier
        if key == "coverVisibleOnResume" { result["activations"] = (result["activations"] as? Int ?? 0) + 1 }
        try? JSONSerialization.data(withJSONObject: result).write(to: file, options: .atomic)
    }
}

struct RootView: View {
    var body: some View {
        NavigationStack { Text("Retained conversation").navigationTitle("Resume test") }
    }
}
