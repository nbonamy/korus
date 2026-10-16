import Foundation
import CryptoKit
import JavaScriptCore

/// Confined to one serial queue. The upstream Noise state machine runs in a private JSContext;
/// this class supplies only Apple cryptographic implementations, with no fallback.
final class AppleCrypto {
    private let context: JSContext
    private let session: JSValue
    enum Failure: Error { case invalidRequest, unavailable }
    private static let maxBytes = 1_048_576

    init(script: String) throws {
        guard let context = JSContext() else { throw Failure.unavailable }
        self.context = context
        let primitive: @convention(block) (String, JSValue) -> JSValue = { [weak context] op, args in
            guard let context else { return JSValue(undefinedIn: JSContext.current()) }
            do { return try Self.primitive(op, args, context) }
            catch { context.exception = JSValue(newErrorFromMessage: "Apple cryptography failed", in: context); return JSValue(undefinedIn: context) }
        }
        context.setObject(primitive, forKeyedSubscript: "nativeCrypto" as NSString)
        context.evaluateScript("""
        globalThis.TextEncoder = class { encode(text) { return nativeCrypto('utf8', {text}); } };
        globalThis.TextDecoder = class { decode(data) { return nativeCrypto('text', {data}); } };
        """)
        context.evaluateScript(script)
        guard context.exception == nil, let session = context.objectForKeyedSubscript("noiseSession"), !session.isUndefined else { throw Failure.unavailable }
        self.session = session
    }

    func execute(_ input: [String: Any]) throws -> [String: Any] {
        guard let op = input["op"] as? String else { throw Failure.invalidRequest }
        func data(_ name: String) throws -> Data {
            guard let value = input[name] as? String, value.count <= Self.maxBytes * 2,
                  let bytes = Data(base64Encoded: value), bytes.count <= Self.maxBytes else { throw Failure.invalidRequest }
            return bytes
        }
        switch op {
        case "identity.generate":
            let key = Curve25519.Signing.PrivateKey()
            return ["privateKey": (key.rawRepresentation + key.publicKey.rawRepresentation).base64EncodedString()]
        case "identity.sign":
            let raw = try data("key")
            guard raw.count == 64 else { throw Failure.invalidRequest }
            let key = try Curve25519.Signing.PrivateKey(rawRepresentation: raw.prefix(32))
            guard key.publicKey.rawRepresentation == raw.suffix(32) else { throw Failure.invalidRequest }
            return ["signature": try key.signature(for: data("data")).base64EncodedString()]
        case "identity.verify":
            let key = try Curve25519.Signing.PublicKey(rawRepresentation: data("key"))
            return ["valid": try key.isValidSignature(data("signature"), for: data("data"))]
        default:
            guard ["create", "close", "writeA", "readA", "writeB", "readB", "writeC", "readC", "split", "encrypt", "decrypt"].contains(op),
                  JSONSerialization.isValidJSONObject(input),
                  try JSONSerialization.data(withJSONObject: input).count <= 1_500_000 else { throw Failure.invalidRequest }
            context.exception = nil
            guard let result = session.call(withArguments: [input]), context.exception == nil,
                  let json = result.toString()?.data(using: .utf8),
                  let output = try JSONSerialization.jsonObject(with: json) as? [String: Any] else { throw Failure.invalidRequest }
            return output
        }
    }

    private static func primitive(_ op: String, _ args: JSValue, _ context: JSContext) throws -> JSValue {
        func data(_ name: String) throws -> Data { try readBytes(args.forProperty(name), context) }
        func output(_ data: Data) throws -> JSValue { try writeBytes(data, context) }
        switch op {
        case "text": return JSValue(object: String(decoding: try data("data"), as: UTF8.self), in: context)
        case "utf8": return try output(Data((args.forProperty("text")?.toString() ?? "").utf8))
        case "encode": return JSValue(object: try data("data").base64EncodedString(), in: context)
        case "decode":
            guard let text = args.forProperty("data")?.toString(), text.count <= maxBytes * 2,
                  let bytes = Data(base64Encoded: text), bytes.count <= maxBytes else { throw Failure.invalidRequest }
            return try output(bytes)
        case "keypair":
            let key = Curve25519.KeyAgreement.PrivateKey()
            let value = JSValue(newObjectIn: context)!
            value.setValue(try output(key.rawRepresentation), forProperty: "privateKey")
            value.setValue(try output(key.publicKey.rawRepresentation), forProperty: "publicKey")
            return value
        case "dh":
            let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data("key"))
            let pub = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: data("pub"))
            return try output(key.sharedSecretFromKeyAgreement(with: pub).withUnsafeBytes { Data($0) })
        case "hash": return try output(Data(SHA256.hash(data: data("data"))))
        case "hkdf":
            return try output(HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: data("data")), salt: data("key"), info: Data(), outputByteCount: 96).withUnsafeBytes { Data($0) })
        case "encrypt":
            let box = try ChaChaPoly.seal(data("data"), using: SymmetricKey(data: data("key")), nonce: ChaChaPoly.Nonce(data: data("nonce")), authenticating: data("ad"))
            return try output(box.ciphertext + box.tag)
        case "decrypt":
            let encrypted = try data("data")
            guard encrypted.count >= 16 else { throw Failure.invalidRequest }
            let box = try ChaChaPoly.SealedBox(nonce: ChaChaPoly.Nonce(data: data("nonce")), ciphertext: encrypted.dropLast(16), tag: encrypted.suffix(16))
            return try output(ChaChaPoly.open(box, using: SymmetricKey(data: data("key")), authenticating: data("ad")))
        default: throw Failure.invalidRequest
        }
    }

    // Typed-array copies avoid JSON-number expansion and keep large history batches off the UI thread.
    private static func readBytes(_ value: JSValue?, _ context: JSContext) throws -> Data {
        guard let value, JSValueGetTypedArrayType(context.jsGlobalContextRef, value.jsValueRef, nil) == kJSTypedArrayTypeUint8Array,
              let object = JSValueToObject(context.jsGlobalContextRef, value.jsValueRef, nil) else { throw Failure.invalidRequest }
        let length = JSObjectGetTypedArrayByteLength(context.jsGlobalContextRef, object, nil)
        let offset = JSObjectGetTypedArrayByteOffset(context.jsGlobalContextRef, object, nil)
        guard length <= maxBytes else { throw Failure.invalidRequest }
        if length == 0 { return Data() }
        guard let pointer = JSObjectGetTypedArrayBytesPtr(context.jsGlobalContextRef, object, nil) else { throw Failure.invalidRequest }
        return Data(bytes: pointer.advanced(by: offset), count: length)
    }
    private static func writeBytes(_ data: Data, _ context: JSContext) throws -> JSValue {
        guard data.count <= maxBytes, let object = JSObjectMakeTypedArray(context.jsGlobalContextRef, kJSTypedArrayTypeUint8Array, data.count, nil) else { throw Failure.invalidRequest }
        if !data.isEmpty {
            guard let pointer = JSObjectGetTypedArrayBytesPtr(context.jsGlobalContextRef, object, nil) else { throw Failure.invalidRequest }
            data.copyBytes(to: pointer.assumingMemoryBound(to: UInt8.self), count: data.count)
        }
        return JSValue(jsValueRef: object, in: context)
    }
}
