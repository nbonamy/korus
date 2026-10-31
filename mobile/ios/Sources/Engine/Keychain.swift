import Foundation
import Security

/// Device-only secrets. Transport credentials support background registration after
/// first unlock; drafts and other values require an unlocked device.
enum Keychain {
    struct ReadFailure: Error { let status: OSStatus }
    private static var service: String { (Bundle.main.bundleIdentifier ?? "companion") + ".vault" }

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    private static func backgroundAccess(_ key: String) -> Bool { key == "device-identity" || key == "paired-hosts" }
    private static func accessibility(_ key: String) -> CFString {
        backgroundAccess(key) ? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly : kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }

    static func read(_ key: String, lookup: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = SecItemCopyMatching) throws -> String? {
        var attributes = query(key)
        attributes[kSecReturnData as String] = true
        attributes[kSecReturnAttributes as String] = true
        var result: CFTypeRef?
        let status = lookup(attributes as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw ReadFailure(status: status) }
        guard let item = result as? [String: Any], let data = item[kSecValueData as String] as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw ReadFailure(status: errSecDecode)
        }
        // Migrate existing pairings on their first successful unlocked read, without
        // copying credentials or writing again during locked background reads.
        if backgroundAccess(key), item[kSecAttrAccessible as String] as? String != accessibility(key) as String {
            let status = SecItemUpdate(query(key) as CFDictionary, [kSecAttrAccessible as String: accessibility(key)] as CFDictionary)
            guard status == errSecSuccess else { throw ReadFailure(status: status) }
        }
        return value
    }

    @discardableResult
    static func write(_ key: String, _ value: String) -> Bool {
        guard let data = value.data(using: .utf8), data.count <= 4 * 1024 * 1024 else { return false }
        let update: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: accessibility(key)]
        var status = SecItemUpdate(query(key) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query(key)
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = accessibility(key)
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    static func remove(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
