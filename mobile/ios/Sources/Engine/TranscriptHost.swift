import Foundation
import WebKit

/// The conversation itself: the shared Vue pane, read-only, in a web view. Everything around it is native.
@MainActor
final class TranscriptHost: NSObject, WKScriptMessageHandler {
    let webView: WKWebView
    var onLoadOlder: ((String) -> Void)?
    var onReadContent: (([String: Any]) -> Void)?
    var onChooseBackend: ((String) -> Void)?
    var onRendered: ((String, Int) -> Void)?
    private var presentation = 0
    private var isReady = false
    private var queue = TranscriptRenderQueue()
    private var latestConversation: String?
    private var latestContext: String?
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

    /// The conversation, or just its surroundings. The page draws one message at a time; whatever arrives while it does is folded into the newest.
    func submit(_ kind: TranscriptRenderQueue.Kind, _ json: String) {
        switch kind {
        case .conversation: presentation += 1; latestConversation = json; latestContext = nil
        case .context: latestContext = json
        }
        guard isReady else { return }
        if let job = queue.enqueue(kind, json) { run(job) }
    }

    private func run(_ job: TranscriptRenderQueue.Job) {
        let revision = presentation
        let script = job.kind == .conversation ? "return await window.companionTranscript.setConversation(json)" : "return await window.companionTranscript.setContext(json)"
        webView.callAsyncJavaScript(script, arguments: ["json": job.json], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if self.presentation == revision, case .success(let value) = result,
               let receipt = value as? [String: Any], let agentID = receipt["agentId"] as? String,
               let readRevision = receipt["revision"] as? Int { self.onRendered?(agentID, readRevision) }
            if let next = self.queue.finish() { self.run(next) }
        }
    }

    /// A new native selection invalidates acknowledgments already in flight.
    func beginSelection() { presentation += 1 }

    func receiveContent(_ json: String) {
        guard isReady else { return }
        webView.callAsyncJavaScript("window.companionTranscript.setContent(json)", arguments: ["json": json], in: nil, in: .page) { _ in }
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
        if event["type"] as? String == "readConversationContent" {
            onReadContent?(event)
            return
        }
        if event["type"] as? String == "backend", let backend = event["backend"] as? String {
            onChooseBackend?(backend)
            return
        }
        guard event["type"] as? String == "ready" else { return }
        isReady = true
        setInsets(top: insets.top, bottom: insets.bottom)
        if let latestConversation, let job = queue.enqueue(.conversation, latestConversation) { run(job) }
        if let latestContext, let job = queue.enqueue(.context, latestContext) { run(job) }
    }
}
