import SwiftUI
import WebKit

/// Hosts the shared conversation pane. The pane scrolls itself; the app tells it how much room the
/// header and the composer take.
struct TranscriptView: UIViewRepresentable {
    let host: TranscriptHost

    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

/// The engine's web view stays in the hierarchy (invisible) so the system never treats it as a hidden page.
struct EngineView: UIViewRepresentable {
    let host: EngineHost

    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
