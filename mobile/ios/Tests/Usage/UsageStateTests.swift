import XCTest
@testable import CompanionUsage

final class UsageStateTests: XCTestCase {
    func testDecodesEngineUsageAndDisplaysRemainingQuotaAndResetWindows() throws {
        let json = """
        {"status":"loaded","providers":[{"backend":"codex","failed":false,"limits":{
          "primary":{"usedPercent":23.4,"windowDurationMins":300,"resetsAt":10601},
          "secondary":{"usedPercent":101,"windowDurationMins":10080,"resetsAt":180000}
        }},{"backend":"claude","limits":null,"failed":true}]}
        """
        let usage = try JSONDecoder().decode(UsageState.self, from: Data(json.utf8))
        XCTAssertEqual(usage.status, .loaded)
        XCTAssertEqual(usage.visibleProviders.map(\.name), ["Codex", "Claude"])
        let rows = usage.providers[0].rows
        XCTAssertEqual(rows.map(\.label), ["5h", "Weekly"])
        XCTAssertEqual(rows.map(\.remaining), ["77%", "0%"])
        XCTAssertEqual(rows.map { $0.reset(at: Date(timeIntervalSince1970: 0)) }, ["2h 57m", "2d 2h"])
        XCTAssertTrue(usage.providers[1].failed)
    }

    func testUnknownAndExpiredLimitsRemainDistinctFromZeroUsage() {
        let unknown = UsageState.Row(id: "primary", window: .init(usedPercent: nil, windowDurationMins: nil, resetsAt: nil), fallback: "Usage")
        XCTAssertEqual(unknown.remaining, "—")
        XCTAssertNil(unknown.reset(at: .now))
        XCTAssertEqual(unknown.label, "Usage")
        let expired = UsageState.Row(id: "primary", window: .init(usedPercent: -10, windowDurationMins: 30, resetsAt: 0), fallback: "Usage")
        XCTAssertEqual(expired.remaining, "100%")
        XCTAssertEqual(expired.reset(at: .now), "0m")
        XCTAssertEqual(expired.label, "30m")
        XCTAssertTrue(UsageState(status: .loaded, providers: [.init(backend: "codex", limits: nil, failed: false)]).visibleProviders.isEmpty)
    }
}
