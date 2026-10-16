/// Connection recovery is silent for five foreground seconds. Retry status changes
/// share one deadline; returning from the background starts a fresh recovery window.
struct ConnectionNoticeState {
    private(set) var deadline: ContinuousClock.Instant?
    private(set) var isVisible = false

    mutating func update(connection: ConnectionState, active: Bool, now: ContinuousClock.Instant = .now) {
        guard active, connection != .connected, connection != .unpaired, connection != .revoked else {
            deadline = nil
            isVisible = false
            return
        }
        if deadline == nil { deadline = now.advanced(by: .seconds(5)) }
        isVisible = now >= deadline!
    }
}
