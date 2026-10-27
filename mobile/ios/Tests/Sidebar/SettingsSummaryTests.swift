import XCTest
@testable import CompanionSidebar

final class SettingsSummaryTests: XCTestCase {
    func testHeaderNamesTheLaptopOnlyWhileConnected() {
        XCTAssertEqual(ConnectionState.connected.summary(laptop: "MacBook Pro", lost: false), "Connected to MacBook Pro")
        XCTAssertEqual(ConnectionState.connected.summary(laptop: nil, lost: false), "Connected")
        XCTAssertNil(ConnectionState.unpaired.summary(laptop: nil, lost: false))
        XCTAssertNil(ConnectionState.revoked.summary(laptop: "MacBook Pro", lost: true))
    }

    func testRecoveryReadsAsConnectingUntilTheLostNoticeAppears() {
        for state in [ConnectionState.connecting, .reconnecting, .disconnected, .error] {
            XCTAssertEqual(state.summary(laptop: "MacBook Pro", lost: false), "Connecting…")
            XCTAssertEqual(state.summary(laptop: "MacBook Pro", lost: true), "Connection lost")
        }
    }

    func testLaptopNamesAreTrimmedAndRefusedWhenBlankOrTooLong() {
        XCTAssertEqual(LaptopName.cleaned("  Work Mac "), "Work Mac")
        XCTAssertNil(LaptopName.cleaned("   "))
        XCTAssertNil(LaptopName.cleaned(String(repeating: "x", count: 61)))
        XCTAssertEqual(LaptopName.cleaned(String(repeating: "x", count: 60))?.count, 60)
    }
}
