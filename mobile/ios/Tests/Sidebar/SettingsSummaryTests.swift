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

    func testConnectionsRowNamesASingleLaptopAndCountsSeveral() {
        XCTAssertEqual(LaptopSummary.text(names: []), "None")
        XCTAssertEqual(LaptopSummary.text(names: ["MacBook Pro"]), "MacBook Pro")
        XCTAssertEqual(LaptopSummary.text(names: ["MacBook Pro", "Mac mini"]), "2 laptops")
    }
}
