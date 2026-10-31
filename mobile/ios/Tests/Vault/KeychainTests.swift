import XCTest
import Security
#if canImport(CompanionVault)
@testable import CompanionVault
#endif

// A locked or denied read must not look like a missing pairing or permit a new device identity.
final class KeychainTests: XCTestCase {
    // A real Security.framework workflow: migrate old transport items, update them,
    // insert fresh credentials, and retain the stricter policy for draft values.
    func testTransportCredentialsMigrateForBackgroundReadsWithoutRelaxingDraftProtection() throws {
        #if os(iOS)
        let service = (Bundle.main.bundleIdentifier ?? "companion") + ".vault"
        XCTAssertNotEqual(service, "com.nabocorp.korus.vault")
        let keys = ["device-identity", "paired-hosts", "draft-keychain-test"]
        func query(_ key: String) -> [String: Any] {
            [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        }
        for key in keys { SecItemDelete(query(key) as CFDictionary) }
        defer { for key in keys { SecItemDelete(query(key) as CFDictionary) } }
        for key in keys.prefix(2) {
            var item = query(key)
            item[kSecValueData as String] = Data("saved-\(key)".utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            XCTAssertEqual(SecItemAdd(item as CFDictionary, nil), errSecSuccess)
        }
        XCTAssertEqual(try Keychain.read("device-identity"), "saved-device-identity")
        XCTAssertTrue(Keychain.write("paired-hosts", "updated-pairing"))
        func stored(_ key: String, value: String, accessibility: CFString) throws {
            var request = query(key)
            request[kSecReturnData as String] = true; request[kSecReturnAttributes as String] = true
            var result: CFTypeRef?
            XCTAssertEqual(SecItemCopyMatching(request as CFDictionary, &result), errSecSuccess)
            let attributes = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(attributes[kSecValueData as String] as? Data, Data(value.utf8))
            XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String, accessibility as String)
        }
        try stored("device-identity", value: "saved-device-identity", accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
        try stored("paired-hosts", value: "updated-pairing", accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
        Keychain.remove("device-identity")
        XCTAssertTrue(Keychain.write("device-identity", "fresh-identity"))
        try stored("device-identity", value: "fresh-identity", accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
        XCTAssertTrue(Keychain.write("draft-keychain-test", "private-draft"))
        try stored("draft-keychain-test", value: "private-draft", accessibility: kSecAttrAccessibleWhenUnlockedThisDeviceOnly)
        #else
        throw XCTSkip("Keychain accessibility classes are verified by the iOS native workflow.")
        #endif
    }
    func testUnavailableStorageNeverLooksLikeAnAbsentPairing() {
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable] {
            XCTAssertThrowsError(try Keychain.read("paired-hosts", lookup: { _, _ in status }))
        }
    }

    func testMissingItemAndSavedPairingRemainDistinct() throws {
        XCTAssertNil(try Keychain.read("paired-hosts", lookup: { _, _ in errSecItemNotFound }))
        let saved = "saved pairing"
        XCTAssertEqual(try Keychain.read("paired-hosts", lookup: { _, result in
            result?.pointee = [kSecValueData as String: Data(saved.utf8),
                              kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary
            return errSecSuccess
        }), saved)
    }
}
