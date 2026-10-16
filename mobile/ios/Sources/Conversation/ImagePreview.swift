import Foundation

/// Only displayed image bytes or web URLs cross the viewer seam. Laptop paths are never read here.
struct ImagePreview: Identifiable {
    let id = UUID()
    let title: String
    let source: Source

    enum Source {
        case data(Data), remote(URL), unavailable
        static let maxBytes = 20_000_000

        init(_ value: String) {
            let formats = ["png", "jpeg", "jpg", "gif", "webp", "heic", "heif", "avif", "bmp"]
            if let comma = value.firstIndex(of: ","),
               formats.contains(where: { value[..<comma].lowercased() == "data:image/\($0);base64" }) {
                let encoded = value[value.index(after: comma)...]
                guard encoded.utf8.count <= (Self.maxBytes + 2) / 3 * 4,
                      let bytes = Data(base64Encoded: String(encoded)), !bytes.isEmpty, bytes.count <= Self.maxBytes else {
                    self = .unavailable; return
                }
                self = .data(bytes)
            } else if let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased()),
                      let host = url.host, !host.isEmpty, url.user == nil, url.password == nil {
                self = .remote(url)
            } else { self = .unavailable }
        }
    }
}
