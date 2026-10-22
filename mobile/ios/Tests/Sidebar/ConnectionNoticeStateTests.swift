import XCTest
@testable import CompanionSidebar

final class ConnectionNoticeStateTests: XCTestCase {
    func testRecoveryStaysSilentUntilFiveSecondsAcrossRetriesAndClearsOnSuccess() {
        var notice = ConnectionNoticeState()
        let start = ContinuousClock.now
        notice.update(connection: .connected, active: true, now: start)
        notice.update(connection: .disconnected, active: true, now: start)
        XCTAssertFalse(notice.isVisible)
        notice.update(connection: .reconnecting, active: true, now: start.advanced(by: .seconds(2)))
        notice.update(connection: .error, active: true, now: start.advanced(by: .milliseconds(4999)))
        XCTAssertFalse(notice.isVisible)
        notice.update(connection: .reconnecting, active: true, now: start.advanced(by: .seconds(5)))
        XCTAssertTrue(notice.isVisible)
        notice.update(connection: .connected, active: true, now: start.advanced(by: .seconds(6)))
        XCTAssertFalse(notice.isVisible)
        XCTAssertNil(notice.deadline)
        notice.update(connection: .disconnected, active: true, now: start.advanced(by: .seconds(7)))
        XCTAssertFalse(notice.isVisible)
        XCTAssertEqual(notice.deadline, start.advanced(by: .seconds(12)))
    }

    func testBackgroundTimeDoesNotConsumeTheForegroundRecoveryWindow() {
        var notice = ConnectionNoticeState()
        let start = ContinuousClock.now
        notice.update(connection: .disconnected, active: true, now: start)
        notice.update(connection: .disconnected, active: false, now: start.advanced(by: .seconds(1)))
        XCTAssertNil(notice.deadline)
        notice.update(connection: .disconnected, active: true, now: start.advanced(by: .seconds(60)))
        XCTAssertFalse(notice.isVisible)
        notice.update(connection: .error, active: true, now: start.advanced(by: .milliseconds(64999)))
        XCTAssertFalse(notice.isVisible)
        notice.update(connection: .error, active: true, now: start.advanced(by: .seconds(65)))
        XCTAssertTrue(notice.isVisible)
        notice.update(connection: .error, active: false, now: start.advanced(by: .seconds(66)))
        XCTAssertFalse(notice.isVisible)
    }

    func testPairingAndRevocationDoNotShowATransientConnectionWarning() {
        for connection in [ConnectionState.unpaired, .revoked] {
            var notice = ConnectionNoticeState()
            let start = ContinuousClock.now
            notice.update(connection: .disconnected, active: true, now: start)
            notice.update(connection: connection, active: true, now: start.advanced(by: .seconds(10)))
            XCTAssertFalse(notice.isVisible)
            XCTAssertNil(notice.deadline)
        }
    }

    func testQuickRefreshNeverShowsAnIndicatorAndALongOneAppearsAfterTheDelay() {
        var indicator = QuietIndicatorState(delay: .seconds(1))
        let start = ContinuousClock.now
        indicator.update(active: true, now: start)
        XCTAssertFalse(indicator.isVisible)
        indicator.update(active: true, now: start.advanced(by: .milliseconds(900)))
        XCTAssertFalse(indicator.isVisible)
        indicator.update(active: false, now: start.advanced(by: .milliseconds(950)))
        XCTAssertNil(indicator.deadline)
        indicator.update(active: true, now: start.advanced(by: .seconds(2)))
        indicator.update(active: true, now: start.advanced(by: .milliseconds(2999)))
        XCTAssertFalse(indicator.isVisible)
        indicator.update(active: true, now: start.advanced(by: .seconds(3)))
        XCTAssertTrue(indicator.isVisible)
        indicator.update(active: false, now: start.advanced(by: .seconds(4)))
        XCTAssertFalse(indicator.isVisible)
    }
}
