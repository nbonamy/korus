import Capacitor
import Security

@objc(CompanionVaultPlugin)
public class CompanionVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CompanionVaultPlugin"
    public let jsName = "CompanionVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private func query(_ call: CAPPluginCall) throws -> [String: Any] {
        guard let key = call.getString("key"), key.range(of: "^[a-zA-Z0-9:._-]{1,128}$", options: .regularExpression) != nil else {
            throw NSError(domain: "CompanionVault", code: 1)
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "companion") + ".vault",
                kSecAttrAccount as String: key]
    }
    @objc func read(_ call: CAPPluginCall) {
        do {
            var attributes = try query(call)
            attributes[kSecReturnData as String] = true
            var result: CFTypeRef?
            let status = SecItemCopyMatching(attributes as CFDictionary, &result)
            if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
            guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
                call.reject("Protected storage is unavailable."); return
            }
            call.resolve(["value": value])
        } catch { call.reject("Invalid storage key.") }
    }
    @objc func write(_ call: CAPPluginCall) {
        do {
            let attributes = try query(call)
            guard let value = call.getString("value"), let data = value.data(using: .utf8), data.count <= 4 * 1024 * 1024 else {
                call.reject("Invalid storage value."); return
            }
            let update = [kSecValueData as String: data]
            var status = SecItemUpdate(attributes as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                var insert = attributes
                insert[kSecValueData as String] = data
                insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                status = SecItemAdd(insert as CFDictionary, nil)
            }
            guard status == errSecSuccess else { call.reject("Protected storage is unavailable."); return }
            call.resolve()
        } catch { call.reject("Invalid storage key.") }
    }
    @objc func remove(_ call: CAPPluginCall) {
        do {
            let status = SecItemDelete(try query(call) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Protected storage is unavailable."); return }
            call.resolve()
        } catch { call.reject("Invalid storage key.") }
    }
}

class CompanionBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompanionVaultPlugin())
    }
}
