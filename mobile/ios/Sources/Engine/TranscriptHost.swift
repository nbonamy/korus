import Foundation
import WebKit
import UIKit

/// The conversation itself: the shared Vue pane, read-only, in a web view. Everything around it is native.
@MainActor
final class TranscriptHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var onOpenImage: ((String, ImagePreview) -> Void)?
    var onFilePreviewVisibility: ((Bool) -> Void)?
    var onLoadOlder: ((String) -> Void)?
    var onReadContent: (([String: Any]) -> Void)?
    var onChooseBackend: ((String) -> Void)?
    var onRendered: ((String, Int, Int) -> Void)?
    var onTransferApplied: ((String, [String: Any]) -> Void)?
    var onNeedsReset: ((String) -> Void)?
    var onRenderFailed: (() -> Void)?
    private var presentation = 0
    private var isReady = false
    private var needsRecovery = false
    private var watchdog: Timer?
    private var navigation: WKNavigation?
    private var queue = TranscriptRenderQueue()
    private var latestKind: TranscriptRenderQueue.Kind = .conversation
    private var latestConversation: String?
    private var latestContext: String?
    private var insets: (top: Double, bottom: Double, leading: Double, trailing: Double) = (0, 0, 0, 0)

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: WebAssets.scheme)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "transcript")
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        loadPage()
    }

    /// The conversation, or just its surroundings. The page draws one message at a time; whatever arrives while it does is folded into the newest.
    func submit(_ kind: TranscriptRenderQueue.Kind, _ json: String) {
        switch kind {
        case .conversation, .transfer: latestKind = kind; latestConversation = json; latestContext = nil
        case .context: latestContext = json
        }
        guard isReady else { return }
        if let job = queue.enqueue(kind, json) { run(job) }
    }

    private func run(_ job: TranscriptRenderQueue.Job) {
        let revision = presentation
        armWatchdog()
        let method: String
        switch job.kind {
        case .conversation: method = "setConversation"
        case .transfer: method = "setTransfer"
        case .context: method = "setContext"
        }
        let script = "return await window.companionTranscript.\(method)(json)"
        webView.callAsyncJavaScript(script, arguments: ["json": job.json], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            guard self.presentation == revision else { return }
            self.watchdog?.invalidate()
            self.watchdog = nil
            if case .failure = result { self.fail(); return }
            if case .success(let value) = result, let receipt = value as? [String: Any], let identity = receipt["identity"] as? String {
                if receipt["needsReset"] as? Bool == true { self.onNeedsReset?(identity) }
                else if let checkpoint = receipt["checkpoint"] as? [String: Any] { self.onTransferApplied?(identity, checkpoint) }
            }
            if case .success(let value) = result,
               let receipt = value as? [String: Any], let agentID = receipt["agentId"] as? String,
               let readRevision = receipt["revision"] as? Int,
               let generation = receipt["generation"] as? Int { self.onRendered?(agentID, readRevision, generation) }
            if let next = self.queue.finish() { self.run(next) }
        }
    }

    /// A new native selection invalidates acknowledgments already in flight.
    func beginSelection() {
        presentation += 1
        watchdog?.invalidate()
        watchdog = nil
        queue = TranscriptRenderQueue()
        latestConversation = nil
        latestContext = nil
        if needsRecovery { loadPage() }
        else if !isReady { armWatchdog() }
    }

    /// Retry the same chat even when the engine's cached selection emits no new frame.
    func retry() {
        presentation += 1
        queue = TranscriptRenderQueue()
        loadPage()
    }

    private func loadPage() {
        needsRecovery = false
        isReady = false
        webView.stopLoading()
        navigation = webView.load(URLRequest(url: WebAssets.url("transcript.html")))
        armWatchdog()
    }

    private func armWatchdog() {
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] timer in
            Task { @MainActor in
                guard let self, self.watchdog === timer else { return }
                // Background suspension is not a rendering failure.
                if UIApplication.shared.applicationState != .active { self.armWatchdog() }
                else { self.fail() }
            }
        }
    }

    private func fail() {
        guard !needsRecovery else { return }
        watchdog?.invalidate()
        watchdog = nil
        presentation += 1
        isReady = false
        needsRecovery = true
        queue = TranscriptRenderQueue()
        onRenderFailed?()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail() }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(navigation, error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(navigation, error)
    }

    private func navigationFailed(_ navigation: WKNavigation?, _ error: Error) {
        guard navigation === self.navigation, (error as NSError).code != NSURLErrorCancelled else { return }
        fail()
    }

    func receiveContent(_ json: String) {
        guard isReady else { return }
        webView.callAsyncJavaScript("window.companionTranscript.setContent(json)", arguments: ["json": json], in: nil, in: .page) { _ in }
    }

    /// Every side separately: on an iPhone Duo's outer display the status bar and the vertical toolbar take the trailing edge only.
    func setInsets(top: Double, bottom: Double, leading: Double, trailing: Double) {
        insets = (top, bottom, leading, trailing)
        guard isReady else { return }
        webView.callAsyncJavaScript("window.companionTranscript.setInsets(top, bottom, leading, trailing)", arguments: ["top": top, "bottom": bottom, "leading": leading, "trailing": trailing], in: nil, in: .page) { _ in }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8),
              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if event["type"] as? String == "openImage", message.frameInfo.isMainFrame,
           let agentID = event["agentId"] as? String, let source = event["src"] as? String {
            onOpenImage?(agentID, ImagePreview(title: event["title"] as? String ?? "Image", source: ImagePreview.Source(source)))
            return
        }
        if event["type"] as? String == "openExternal", message.frameInfo.isMainFrame,
           let value = event["url"] as? String, let url = ExternalLink.url(value) {
            UIApplication.shared.open(url)
            return
        }
        if event["type"] as? String == "loadOlder", let agentID = event["agentId"] as? String {
            onLoadOlder?(agentID)
            return
        }
        if event["type"] as? String == "filePreviewVisibility", message.frameInfo.isMainFrame, let open = event["open"] as? Bool {
            onFilePreviewVisibility?(open)
            return
        }
        if ["readConversationContent", "readConversationImage", "readFilePreview"].contains(event["type"] as? String ?? ""), message.frameInfo.isMainFrame {
            onReadContent?(event)
            return
        }
        if event["type"] as? String == "backend", let backend = event["backend"] as? String {
            onChooseBackend?(backend)
            return
        }
        guard event["type"] as? String == "ready" else { return }
        guard !needsRecovery else { return }
        watchdog?.invalidate()
        watchdog = nil
        isReady = true
        setInsets(top: insets.top, bottom: insets.bottom, leading: insets.leading, trailing: insets.trailing)
        if let latestConversation, let job = queue.enqueue(latestKind, latestConversation) { run(job) }
        if let latestContext, let job = queue.enqueue(.context, latestContext) { run(job) }
    }
}
