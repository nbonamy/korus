import Foundation

/// Eight symbols without look-alikes, displayed in two groups of four.
enum PairingCode {
    private static let alphabet = Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func format(_ input: String) -> String {
        let symbols = input.uppercased().filter { alphabet.contains($0) }.prefix(8)
        guard symbols.count > 4 else { return String(symbols) }
        return "\(symbols.prefix(4))-\(symbols.dropFirst(4))"
    }

    static func isComplete(_ formatted: String) -> Bool { formatted.filter { $0 != "-" }.count == 8 }

    /// Camera input must be a complete code, never a truncated URL or unrelated QR payload.
    static func scanned(_ payload: String) -> String? {
        let value = payload.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let symbols: String
        if value.count == 9, value[value.index(value.startIndex, offsetBy: 4)] == "-" {
            symbols = String(value.prefix(4)) + value.suffix(4)
        } else {
            symbols = value
        }
        guard symbols.count == 8, symbols.allSatisfy({ alphabet.contains($0) }) else { return nil }
        return format(symbols)
    }
}

/// A camera can report the same barcode on multiple frames; accept only one per presentation.
struct PairingScan {
    private var completed = false

    mutating func accept(_ payload: String) -> String? {
        guard !completed, let code = PairingCode.scanned(payload) else { return nil }
        completed = true
        return code
    }
}
