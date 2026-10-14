import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled web pages from a secure custom scheme, so they behave like an ordinary origin
/// (same-origin module scripts, a secure context for the crypto the transport needs).
final class WebAssets: NSObject, WKURLSchemeHandler {
    static let scheme = "companion"
    static let host = "app"

    static func url(_ page: String) -> URL { URL(string: "\(scheme)://\(host)/\(page)")! }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let file = Self.file(for: url) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        do {
            let data = try Data(contentsOf: file)
            let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*"])!
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    /// Only files inside the bundled `Web` folder are reachable.
    private static func file(for url: URL) -> URL? {
        guard let root = Bundle.main.url(forResource: "Web", withExtension: nil) else { return nil }
        let relative = url.path.split(separator: "/").map(String.init)
        guard !relative.contains("..") else { return nil }
        let file = relative.reduce(root) { $0.appendingPathComponent($1) }
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }
}
