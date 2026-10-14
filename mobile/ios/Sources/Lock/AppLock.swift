import Foundation
import LocalAuthentication
import Observation

/// What proves the person holding the phone is its owner: Face ID or Touch ID, with the device passcode as the fallback.
protocol DeviceOwnerAuthenticating {
    /// False on a phone with no passcode: there is nothing to check, so nothing is locked.
    var isAvailable: Bool { get }
    func authenticate(reason: String) async -> Bool
}

struct SystemAuthenticator: DeviceOwnerAuthenticating {
    var isAvailable: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func authenticate(reason: String) async -> Bool {
        (try? await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

/// The app opens locked, and locks again after being away for longer than a short grace period.
/// The laptop pairing stays usable: this only decides whether the screen may be seen.
@MainActor
@Observable
final class AppLock {
    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    /// Whether this phone can lock the app at all.
    let isProtecting: Bool
    private let authenticator: DeviceOwnerAuthenticating
    private let gracePeriod: TimeInterval
    private let now: () -> Date
    private var leftAt: Date?

    init(authenticator: DeviceOwnerAuthenticating = SystemAuthenticator(), gracePeriod: TimeInterval = 30, now: @escaping () -> Date = Date.init) {
        self.authenticator = authenticator
        self.gracePeriod = gracePeriod
        self.now = now
        isProtecting = authenticator.isAvailable
        isLocked = isProtecting
    }

    /// The app went to the background. (Briefly inactive, such as the system's own Face ID sheet, is not leaving.)
    func didLeave() {
        if leftAt == nil { leftAt = now() }
    }

    func didReturn() {
        defer { leftAt = nil }
        guard isProtecting, let leftAt, now().timeIntervalSince(leftAt) >= gracePeriod else { return }
        isLocked = true
    }

    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        isAuthenticating = true
        let verified = await authenticator.authenticate(reason: "Unlock to see your conversations.")
        isAuthenticating = false
        if verified { isLocked = false }
    }
}
