import SwiftUI
import WebKit

/// The native layout bounds the shared pane above the composer, including keyboard and drawer changes.
struct TranscriptView: View {
    let host: TranscriptHost

    var body: some View {
        GeometryReader { proxy in
            TranscriptWebView(host: host)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipped()
        }
    }
}

private struct TranscriptWebView: UIViewRepresentable {
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
