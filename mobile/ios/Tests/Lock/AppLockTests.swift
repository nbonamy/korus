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

    private func make(available: Bool = true, verdict: Bool = true) -> (AppLock, Authenticator, Clock) {
        let authenticator = Authenticator(); authenticator.isAvailable = available; authenticator.verdict = verdict
        let clock = Clock()
        return (AppLock(authenticator: authenticator, gracePeriod: 30, now: { clock.date }), authenticator, clock)
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

    func testAShortAbsenceKeepsTheAppOpenAndALongOneLocksIt() async {
        let (lock, authenticator, clock) = make()
        let opening = Task { await lock.unlock() }
        await answer(authenticator); await opening.value
        lock.didLeave(); clock.advance(29); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
        lock.didLeave(); clock.advance(30); lock.didReturn()
        XCTAssertTrue(lock.isLocked)
    }

    func testComingBackWithoutHavingLeftDoesNotLock() async {
        let (lock, authenticator, clock) = make()
        let opening = Task { await lock.unlock() }
        await answer(authenticator); await opening.value
        clock.advance(3_600); lock.didReturn()
        XCTAssertFalse(lock.isLocked)
    }
}
