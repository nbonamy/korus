import Foundation
import Security

/// Device-only secrets (the pairing record and this phone's identity). Entries are readable while unlocked
/// and never leave the device.
enum Keychain {
    private static var service: String { (Bundle.main.bundleIdentifier ?? "companion") + ".vault" }

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    static func read(_ key: String) -> String? {
        var attributes = query(key)
        attributes[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func write(_ key: String, _ value: String) -> Bool {
        guard let data = value.data(using: .utf8), data.count <= 4 * 1024 * 1024 else { return false }
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query(key) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query(key)
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    static func remove(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
