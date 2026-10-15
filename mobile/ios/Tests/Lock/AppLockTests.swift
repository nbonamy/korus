import XCTest
@testable import CompanionLock

@MainActor
final class AppLockTests: XCTestCase {
    private final class Authenticator: DeviceOwnerAuthenticating {
        var isAvailable = true
        var verdict = true
        private(set) var calls = 0
        var gate: CheckedContinuation<Void, Never>?
        func authenticate(reason: String) async -> Bool {
            calls += 1
            if gate == nil { await withCheckedContinuation { gate = $0 } }
            return verdict
        }
    }
    private final class Clock { var date = Date(timeIntervalSince1970: 1_000); func advance(_ seconds: TimeInterval) { date.addTimeInterval(seconds) } }

    private func defaults(enabled: Bool) -> UserDefaults {
        let store = UserDefaults(suiteName: "lock-tests-\(UUID().uuidString)")!
        store.set(enabled, forKey: AppLock.defaultsKey)
        return store
    }
    private func make(available: Bool = true, verdict: Bool = true, enabled: Bool = true, store: UserDefaults? = nil) -> (AppLock, Authenticator, Clock) {
        let authenticator = Authenticator(); authenticator.isAvailable = available; authenticator.verdict = verdict
        let clock = Clock()
        return (AppLock(authenticator: authenticator, defaults: store ?? defaults(enabled: enabled), now: { clock.date }), authenticator, clock)
    }
    /// Lets the authenticator's pending answer through.
    private func answer(_ authenticator: Authenticator) async {
        while authenticator.gate == nil { await Task.yield() }
        authenticator.gate?.resume(); authenticator.gate = nil
    }

    func testOpensLockedWhenTheDeviceCanProveItsOwner() {
        XCTAssertTrue(make().0.isLocked)
    }

    func testAPhoneWithoutAPasscodeHasNothingToCheckAndNeverLocks() {
        let (lock, _, clock) = make(available: false)
        XCTAssertFalse(lock.isLocked)
        lock.didLeave(); clock.advance(3_600); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
    }

    func testVerifyingTheOwnerUnlocks() async {
        let (lock, authenticator, _) = make()
        let unlocking = Task { await lock.unlock() }
        await answer(authenticator); await unlocking.value
        XCTAssertFalse(lock.isLocked)
    }

    func testAFailedCheckStaysLockedAndCanBeTriedAgain() async {
        let (lock, authenticator, _) = make(verdict: false)
        let first = Task { await lock.unlock() }
        await answer(authenticator); await first.value
        XCTAssertTrue(lock.isLocked)
        authenticator.verdict = true
        let second = Task { await lock.unlock() }
        await answer(authenticator); await second.value
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.calls, 2)
    }

    func testOnlyOneCheckRunsAtATime() async {
        let (lock, authenticator, _) = make()
        let first = Task { await lock.unlock() }
        while authenticator.gate == nil { await Task.yield() }
        await lock.unlock()
        XCTAssertEqual(authenticator.calls, 1)
        await answer(authenticator); await first.value
    }

    func testReturningBeforeFiveMinutesStaysUnlockedAndFiveMinutesLocks() async {
        let (lock, authenticator, clock) = make()
        let opening = Task { await lock.unlock() }
        await answer(authenticator); await opening.value
        lock.didLeave(); clock.advance(5); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(authenticator.calls, 1)
        lock.didLeave(); clock.advance(299); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
        lock.didLeave(); clock.advance(300); lock.didReturn()
        XCTAssertTrue(lock.isLocked)
    }

    func testComingBackWithoutHavingLeftDoesNotLock() async {
        let (lock, authenticator, clock) = make()
        let opening = Task { await lock.unlock() }
        await answer(authenticator); await opening.value
        clock.advance(3_600); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
    }

    func testItIsOffUntilThePersonTurnsItOn() {
        let (lock, _, clock) = make(enabled: false)
        XCTAssertFalse(lock.isEnabled); XCTAssertFalse(lock.isLocked); XCTAssertFalse(lock.isProtecting)
        lock.didLeave(); clock.advance(3_600); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
    }

    func testTurningItOnAsksForTheOwnerOnceAndKeepsTheChoiceAcrossLaunches() async {
        let store = defaults(enabled: false)
        let (lock, authenticator, _) = make(store: store)
        let turningOn = Task { await lock.setEnabled(true) }
        await answer(authenticator); await turningOn.value
        XCTAssertTrue(lock.isEnabled)
        XCTAssertFalse(lock.isLocked) // already proven: the person is inside
        XCTAssertEqual(authenticator.calls, 1)
        let (relaunched, _, _) = make(store: store)
        XCTAssertTrue(relaunched.isLocked)
    }

    func testAFailedCheckLeavesItOff() async {
        let (lock, authenticator, _) = make(verdict: false, enabled: false)
        let turningOn = Task { await lock.setEnabled(true) }
        await answer(authenticator); await turningOn.value
        XCTAssertFalse(lock.isEnabled)
    }

    func testAPhoneWithoutAPasscodeCannotTurnItOn() async {
        let (lock, authenticator, _) = make(available: false, enabled: false)
        await lock.setEnabled(true)
        XCTAssertFalse(lock.isEnabled)
        XCTAssertFalse(lock.canProtect)
        XCTAssertEqual(authenticator.calls, 0)
    }

    func testALockedPresentationCannotDisableProtection() async {
        let (lock, _, _) = make()
        await lock.setEnabled(false)
        XCTAssertTrue(lock.isEnabled)
        XCTAssertTrue(lock.isLocked)
    }

    func testTurningItOffUnlocksAtOnceAndStaysOffAfterRestart() async {
        let store = defaults(enabled: true)
        let (lock, authenticator, _) = make(store: store)
        let unlocking = Task { await lock.unlock() }
        await answer(authenticator); await unlocking.value
        await lock.setEnabled(false)
        XCTAssertFalse(lock.isEnabled); XCTAssertFalse(lock.isLocked)
        XCTAssertFalse(make(store: store).0.isLocked)
    }
}
