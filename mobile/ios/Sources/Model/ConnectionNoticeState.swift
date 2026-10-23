/// An indicator that appears only if its condition outlasts a delay, so a brief recovery never flashes.
struct QuietIndicatorState {
    let delay: Duration
    private(set) var deadline: ContinuousClock.Instant?
    private(set) var isVisible = false

    init(delay: Duration) { self.delay = delay }

    mutating func update(active: Bool, now: ContinuousClock.Instant = .now) {
        guard active else {
            deadline = nil
            isVisible = false
            return
        }
        let due = deadline ?? now.advanced(by: delay)
        deadline = due
        isVisible = now >= due
    }
}

/// Connection recovery is silent for five foreground seconds. Retry status changes
/// share one deadline; returning from the background starts a fresh recovery window.
struct ConnectionNoticeState {
    private var indicator = QuietIndicatorState(delay: .seconds(5))
    var deadline: ContinuousClock.Instant? { indicator.deadline }
    var isVisible: Bool { indicator.isVisible }

    mutating func update(connection: ConnectionState, active: Bool, now: ContinuousClock.Instant = .now) {
        let recovering = active && connection != .connected && connection != .unpaired && connection != .revoked
        indicator.update(active: recovering, now: now)
    }
}

/// Waits for an indicator's deadline so it can be shown without any other event arriving. A new wait replaces the old one.
@MainActor
final class DeadlineWatcher {
    private var task: Task<Void, Never>?

    func wait(until deadline: ContinuousClock.Instant?, then fire: @escaping @MainActor () -> Void) {
        task?.cancel()
        task = nil
        guard let deadline else { return }
        task = Task {
            do { try await Task.sleep(until: deadline, clock: .continuous) }
            catch { return }
            fire()
        }
    }
}
