import SwiftUI
import WebKit

/// Only an already authorized patch reaches this page; it has no backend or filesystem bridge.
@MainActor
final class ChangesHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private var ready = false
    private var latest = "{\"diff\":\"\"}"

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: WebAssets.scheme)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "changes")
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: WebAssets.url("changes.html")))
    }

    func setDiff(_ json: String) { latest = json; apply() }

    private func apply() {
        guard ready else { return }
        webView.callAsyncJavaScript("window.companionChanges.setDiff(payload)", arguments: ["payload": latest], in: nil, in: .page) { _ in }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === webView, message.frameInfo.isMainFrame,
              message.frameInfo.request.url == WebAssets.url("changes.html"),
              let body = message.body as? [String: Any], body["type"] as? String == "ready" else { return }
        ready = true; apply()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ready = false; webView.reload() }
}

struct ChangesWebView: UIViewRepresentable {
    let host: ChangesHost
    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
