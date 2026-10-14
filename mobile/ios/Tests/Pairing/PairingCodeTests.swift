import XCTest
@testable import CompanionPairing

final class PairingCodeTests: XCTestCase {
    func testManualEntryStillFormatsIncrementally() {
        XCTAssertEqual(PairingCode.format("ab c"), "ABC")
        XCTAssertEqual(PairingCode.format("abcd23ef"), "ABCD-23EF")
        XCTAssertFalse(PairingCode.isComplete("ABCD-23E"))
        XCTAssertTrue(PairingCode.isComplete("ABCD-23EF"))
    }

    func testScannerAcceptsDesktopCodeButDoesNotExtractCodesFromUnrelatedPayloads() {
        XCTAssertEqual(PairingCode.scanned("ABCD-23EF"), "ABCD-23EF")
        XCTAssertEqual(PairingCode.scanned(" abcd23ef\n"), "ABCD-23EF")
        for payload in ["https://example.com/ABCD-23EF", "{\"code\":\"ABCD-23EF\"}",
                        "ABCD-23EF-extra", "ABCD", "ABCD-01IO", "AB-CD23EF", "ABCD 23EF"] {
            XCTAssertNil(PairingCode.scanned(payload), payload)
        }
    }

    func testInvalidScanCanBeRetriedAndRepeatedFramesCannotPairTwice() {
        var scan = PairingScan()
        XCTAssertNil(scan.accept("https://example.com"))
        XCTAssertEqual(scan.accept("ABCD-23EF"), "ABCD-23EF")
        XCTAssertNil(scan.accept("ABCD-23EF"))
        XCTAssertNil(scan.accept("WXYZ-6789"))
        var nextPresentation = PairingScan()
        XCTAssertEqual(nextPresentation.accept("WXYZ-6789"), "WXYZ-6789")
    }
}
