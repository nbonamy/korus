import Foundation
import Security
import WebKit

/// Runs the companion engine (relay link, pairing, laptop calls) in a web view the person never sees,
/// and keeps its secrets in the Keychain.
@MainActor
final class EngineHost: NSObject, WKScriptMessageHandlerWithReply, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var onSendResult: ((ComposerSendResult) -> Void)?
    var onNotification: ((ChatNotification) -> Void)?
    var onNotificationOpenFailed: (() -> Void)?
    var onLiveActivityRegistered: ((String, Bool) -> Void)?
    /// The engine page was killed by the system and has loaded again from scratch; everything it knew must be told to it anew.
    var onRestarted: (() -> Void)?
    var onGitDiff: ((String) -> Void)?
    var onState: ((EngineState) -> Void)?
    var onContent: ((String) -> Void)?
    var onTranscript: ((TranscriptRenderQueue.Kind, String) -> Void)?
    private let crypto = AppleCryptoService(scriptURL: Bundle.main.url(forResource: "noise-session", withExtension: "js", subdirectory: "Web"))
    private var isReady = false
    private var hasBeenReady = false
    private var pending: [[String: Any]] = []
    private let diagnosticQueue = DispatchQueue(label: "companion.connection-diagnostics", qos: .utility)
    private let connectionLog = ConnectionLog(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Diagnostics"))

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.inactiveSchedulingPolicy = .none
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: WebAssets.scheme)
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        super.init()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        configuration.userContentController.add(self, name: "engine")
        webView.navigationDelegate = self
        diagnosticQueue.async { [connectionLog] in
            connectionLog.append(["event": "app.engine-start", "at": ISO8601DateFormatter().string(from: Date()),
                                  "stage": "build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown")"])
        }
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: WebAssets.url("engine.html")))
    }

    /// Sends one command to the engine; commands issued before it is ready wait for it.
    func dispatch(_ command: [String: Any]) {
        let type = command["type"] as? String
        if type == "activity" {
            recordLifecycle("app.native-activity", stage: command["active"] as? Bool == true ? "foreground" : "background")
        }
        guard isReady else {
            // Only the latest word on visibility matters to an engine that is not listening yet.
            if type == "activity" { pending.removeAll { $0["type"] as? String == "activity" } }
            pending.append(command)
            return
        }
        send(command)
    }

    private func send(_ command: [String: Any]) {
        let started = Date()
        let foreground = command["type"] as? String == "activity" && command["active"] as? Bool == true
        guard let data = try? JSONSerialization.data(withJSONObject: command), let json = String(data: data, encoding: .utf8) else { return }
        webView.callAsyncJavaScript("await window.companionEngine.dispatch(command)", arguments: ["command": json], in: nil, in: .page) { [weak self] result in
            if foreground {
                self?.recordLifecycle("app.foreground-dispatched", stage: { if case .success = result { return "ready" }; return "failed" }(), elapsedMs: Date().timeIntervalSince(started) * 1000)
            }
            if case .failure = result, let id = command["requestId"] as? String {
                self?.onSendResult?(ComposerSendResult(requestId: id, status: .unknown))
            }
        }
    }

    func recordLifecycle(_ event: String, stage: String, elapsedMs: Double? = nil) {
        var record: [String: Any] = ["event": event, "at": ISO8601DateFormatter().string(from: Date()), "stage": stage]
        if let elapsedMs { record["elapsedMs"] = elapsedMs }
        diagnosticQueue.async { [connectionLog, record] in connectionLog.append(record) }
    }

    // MARK: Requests the engine page makes of the app

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.webView === webView,
              message.frameInfo.request.url == WebAssets.url("engine.html"),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { replyHandler(nil, "Invalid request."); return }
        switch type {
        case "imageCache.read", "imageCache.write", "imageCache.forget":
            guard let host = body["host"] as? String else { replyHandler(nil, "Invalid image cache scope."); return }
            let key = body["key"] as? String ?? "", dataUrl = body["dataUrl"] as? String ?? ""
            Task {
                do {
                    let cache = DeviceImageCache.shared
                    switch type {
                    case "imageCache.read": replyHandler(try await cache.read(host: host, key: key) as Any? ?? NSNull(), nil)
                    case "imageCache.write": try await cache.write(host: host, key: key, dataUrl: dataUrl); replyHandler(true, nil)
                    default: try await cache.forget(host: host); replyHandler(true, nil)
                    }
                } catch { replyHandler(nil, "Image cache is unavailable.") }
            }
        case "connection.diagnostic":
            guard let record = body["record"] as? [String: Any] else { replyHandler(nil, "Invalid diagnostic."); return }
            diagnosticQueue.async { [connectionLog] in connectionLog.append(record) }
            replyHandler(true, nil)
        case "crypto":
            guard let command = body["command"] as? [String: Any] else { replyHandler(nil, "Invalid crypto request."); return }
            crypto.execute(command) { result in
                Task { @MainActor in
                    switch result {
                    case .success(let value): replyHandler(value, nil)
                    case .failure: replyHandler(nil, "Apple cryptography unavailable.")
                    }
                }
            }
        case "vault.read":
            do {
                let value = try Keychain.read(body["key"] as? String ?? "")
                replyHandler(["value": value as Any? ?? NSNull()], nil)
            } catch {
                // Only the OS status is diagnostic metadata; keys and stored values stay private.
                recordLifecycle("app.vault-read-failed", stage: String((error as? Keychain.ReadFailure)?.status ?? errSecDecode))
                replyHandler(nil, "Protected storage is unavailable. Unlock your phone and try again.")
            }
        case "vault.write": replyHandler(Keychain.write(body["key"] as? String ?? "", body["value"] as? String ?? ""), nil)
        case "vault.remove": Keychain.remove(body["key"] as? String ?? ""); replyHandler(true, nil)
        case "relay":
            let origin = (Bundle.main.object(forInfoDictionaryKey: "CompanionRelayURL") as? String) ?? ""
            let peer = (Bundle.main.object(forInfoDictionaryKey: "CompanionRelayPeerID") as? String) ?? ""
            var config: [String: Any] = ["origin": origin, "peerId": peer]
            #if DEBUG
            config["allowLocalDevelopment"] = true
            #endif
            replyHandler(origin.isEmpty || peer.isEmpty ? NSNull() : config, nil)
        default: replyHandler(nil, "Unknown request.")
        }
    }

    // MARK: Events from the engine

    /// The engine page tags each event with its type and sends the serialized event as a string, so a conversation
    /// is never parsed here: it goes to the transcript as it came.
    private struct NotificationEvent: Decodable { let notification: ChatNotification }
    private struct StateEvent: Decodable { let state: EngineState }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let json = body["json"] as? String
        switch type {
        case "ready":
            let restarted = hasBeenReady
            isReady = true; hasBeenReady = true
            webView.callAsyncJavaScript("await window.companionEngine.start()", arguments: [:], in: nil, in: .page) { _ in }
            let queued = pending
            pending.removeAll()
            for command in queued { send(command) }
            if restarted { onRestarted?() }
        case "gitDiff": if let json { onGitDiff?(json) }
        case "notification":
            if let data = json?.data(using: .utf8), let decoded = try? JSONDecoder().decode(NotificationEvent.self, from: data) { onNotification?(decoded.notification) }
        case "notificationOpenFailed": onNotificationOpenFailed?()
        case "liveActivityRegistered":
            if let data = json?.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = value["requestId"] as? String, let success = value["success"] as? Bool { onLiveActivityRegistered?(id, success) }
        case "sendResult":
            if let data = json?.data(using: .utf8), let decoded = try? JSONDecoder().decode(ComposerSendResult.self, from: data) { onSendResult?(decoded) }
        case "state":
            if let data = json?.data(using: .utf8), let decoded = try? JSONDecoder().decode(StateEvent.self, from: data) { onState?(decoded.state) }
        case "conversationTransfer": if let json { onTranscript?(.transfer, json) }
        case "conversation": if let json { onTranscript?(.conversation, json) }
        case "conversationContext": if let json { onTranscript?(.context, json) }
        case "turnHistory": if let json { onContent?(json) }
        case "conversationContent": if let json { onContent?(json) }
        case "conversationImage": if let json { onContent?(json) }
        case "conversationFile": if let json { onContent?(json) }
        default: break
        }
    }
}

extension EngineHost {
    /// iOS can kill the page's process while the app lives. The page is loaded again; commands that were in flight are lost.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recordLifecycle("app.webcontent-terminated", stage: "reload")
        isReady = false
        pending.removeAll()
        webView.load(URLRequest(url: WebAssets.url("engine.html")))
    }
}
