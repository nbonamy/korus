import Foundation

/// External conversation links use the OS handler; local files and app routes stay inside the app.
enum ExternalLink {
    static func url(_ value: String) -> URL? {
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased() else { return nil }
        switch scheme {
        case "http", "https": return url.host?.isEmpty == false ? url : nil
        case "mailto", "tel": return url.path.isEmpty ? nil : url
        default: return nil
        }
    }
}
