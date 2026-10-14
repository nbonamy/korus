import Foundation
import WebKit

/// The conversation itself: the shared Vue pane, read-only, in a web view. Everything around it is native.
@MainActor
final class TranscriptHost: NSObject, WKScriptMessageHandler {
    let webView: WKWebView
    var onLoadOlder: ((String) -> Void)?
    private var isReady = false
    private var conversation: String?
    private var insets: (top: Double, bottom: Double) = (0, 0)

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: WebAssets.scheme)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "transcript")
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isInspectable = true
        webView.load(URLRequest(url: WebAssets.url("transcript.html")))
    }

    func setConversation(_ json: String) {
        conversation = json
        guard isReady else { return }
        webView.callAsyncJavaScript("window.companionTranscript.setConversation(json)", arguments: ["json": json], in: nil, in: .page) { _ in }
    }

    func setInsets(top: Double, bottom: Double) {
        insets = (top, bottom)
        guard isReady else { return }
        webView.callAsyncJavaScript("window.companionTranscript.setInsets(top, bottom)", arguments: ["top": top, "bottom": bottom], in: nil, in: .page) { _ in }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8),
              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if event["type"] as? String == "loadOlder", let agentID = event["agentId"] as? String {
            onLoadOlder?(agentID)
            return
        }
        guard event["type"] as? String == "ready" else { return }
        isReady = true
        setInsets(top: insets.top, bottom: insets.bottom)
        if let conversation { setConversation(conversation) }
    }
}
