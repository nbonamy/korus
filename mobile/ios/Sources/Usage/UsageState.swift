import Foundation

/// The laptop's quota windows, with the same remaining percentage and reset countdown as desktop.
struct UsageState: Decodable, Equatable {
    enum Status: String, Decodable { case idle, loading, loaded, failed }
    var status: Status = .idle
    var providers: [Provider] = []
    var visibleProviders: [Provider] { providers.filter { $0.failed || !$0.rows.isEmpty } }

    struct Provider: Decodable, Equatable, Identifiable {
        let backend: String
        let limits: Limits?
        let failed: Bool
        var id: String { backend }
        var name: String {
            switch backend {
            case "codex": "Codex"
            case "claude": "Claude"
            default: backend.capitalized
            }
        }
        var rows: [Row] {
            [limits?.primary.map { Row(id: "primary", window: $0, fallback: "Usage") },
             limits?.secondary.map { Row(id: "secondary", window: $0, fallback: "Weekly") }].compactMap { $0 }
        }
    }

    struct Limits: Decodable, Equatable { let primary: Window?; let secondary: Window? }
    struct Window: Decodable, Equatable {
        let usedPercent: Double?
        let windowDurationMins: Int?
        let resetsAt: Double?
    }
    struct Row: Identifiable {
        let id: String
        let window: Window
        let fallback: String
        var label: String {
            guard let duration = window.windowDurationMins, duration > 0 else { return fallback }
            if duration == 10_080 { return "Weekly" }
            return duration % 60 == 0 ? "\(duration / 60)h" : "\(duration)m"
        }
        var remaining: String {
            guard let used = window.usedPercent, used.isFinite else { return "—" }
            return "\(Int(min(100, max(0, (100 - used).rounded()))))%"
        }
        func reset(at date: Date) -> String? {
            guard let reset = window.resetsAt, reset.isFinite else { return nil }
            let count = min(Double(Int.max / 2), max(0, ceil((reset - date.timeIntervalSince1970) / 60)))
            let total = Int(count)
            let days = total / 1440, hours = (total % 1440) / 60, minutes = total % 60
            if days > 0 { return "\(days)d \(hours)h" }
            if hours > 0 { return "\(hours)h \(minutes)m" }
            return "\(minutes)m"
        }
    }
}
