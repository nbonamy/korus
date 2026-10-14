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

/// When turned on, the app opens locked and locks again after being away for longer than a short grace period.
/// The laptop pairing stays usable: this only decides whether the screen may be seen. It is off until the person turns it on.
@MainActor
@Observable
final class AppLock {
    static let defaultsKey = "appLock.enabled"

    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    private(set) var isEnabled: Bool
    private let authenticator: DeviceOwnerAuthenticating
    private let defaults: UserDefaults
    private let gracePeriod: TimeInterval
    private let now: () -> Date
    private var leftAt: Date?

    init(authenticator: DeviceOwnerAuthenticating = SystemAuthenticator(), defaults: UserDefaults = .standard,
         gracePeriod: TimeInterval = 30, now: @escaping () -> Date = Date.init) {
        self.authenticator = authenticator
        self.defaults = defaults
        self.gracePeriod = gracePeriod
        self.now = now
        let enabled = defaults.bool(forKey: Self.defaultsKey)
        isEnabled = enabled
        isLocked = enabled && authenticator.isAvailable
    }

    /// Whether the lock is doing anything right now: turned on, and the phone can prove its owner.
    var isProtecting: Bool { isEnabled && authenticator.isAvailable }
    /// Whether the phone can lock at all: it needs a passcode.
    var canProtect: Bool { authenticator.isAvailable }

    /// Turning it on asks for Face ID once, so the lock is known to work before it can shut the person out.
    func setEnabled(_ on: Bool) async {
        if on {
            guard canProtect, !isAuthenticating else { return }
            isAuthenticating = true
            let verified = await authenticator.authenticate(reason: "Turn on the lock.")
            isAuthenticating = false
            guard verified else { return }
        }
        isEnabled = on
        defaults.set(on, forKey: Self.defaultsKey)
        isLocked = false
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
