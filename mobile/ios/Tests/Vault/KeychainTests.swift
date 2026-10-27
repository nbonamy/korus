import XCTest
import Security
@testable import CompanionVault

// A locked or denied read must not look like a missing pairing or permit a new device identity.
final class KeychainTests: XCTestCase {
    func testUnavailableStorageNeverLooksLikeAnAbsentPairing() {
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable] {
            XCTAssertThrowsError(try Keychain.read("paired-hosts", lookup: { _, _ in status }))
        }
    }

    func testMissingItemAndSavedPairingRemainDistinct() throws {
        XCTAssertNil(try Keychain.read("paired-hosts", lookup: { _, _ in errSecItemNotFound }))
        let saved = "saved pairing"
        XCTAssertEqual(try Keychain.read("paired-hosts", lookup: { _, result in
            result?.pointee = Data(saved.utf8) as CFData
            return errSecSuccess
        }), saved)
    }
}
