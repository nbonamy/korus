import Foundation
import WebKit

/// Runs the companion engine (relay link, pairing, laptop calls) in a web view the person never sees,
/// and keeps its secrets in the Keychain.
@MainActor
final class EngineHost: NSObject, WKScriptMessageHandlerWithReply, WKScriptMessageHandler {
    let webView: WKWebView
    var onState: ((EngineState) -> Void)?
    var onTranscript: ((TranscriptRenderQueue.Kind, String) -> Void)?
    private var isReady = false
    private var pending: [[String: Any]] = []

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: WebAssets.scheme)
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        super.init()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        configuration.userContentController.add(self, name: "engine")
        webView.isInspectable = true
        webView.load(URLRequest(url: WebAssets.url("engine.html")))
    }

    /// Sends one command to the engine; commands issued before it is ready wait for it.
    func dispatch(_ command: [String: Any]) {
        guard isReady else { pending.append(command); return }
        guard let data = try? JSONSerialization.data(withJSONObject: command), let json = String(data: data, encoding: .utf8) else { return }
        webView.callAsyncJavaScript("await window.companionEngine.dispatch(command)", arguments: ["command": json], in: nil, in: .page) { _ in }
    }

    // MARK: Requests the engine page makes of the app

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { replyHandler(nil, "Invalid request."); return }
        switch type {
        case "vault.read": replyHandler(["value": Keychain.read(body["key"] as? String ?? "") as Any? ?? NSNull()], nil)
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
    private struct StateEvent: Decodable { let state: EngineState }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let json = body["json"] as? String
        switch type {
        case "ready":
            isReady = true
            webView.callAsyncJavaScript("await window.companionEngine.start()", arguments: [:], in: nil, in: .page) { _ in }
            for command in pending { dispatch(command) }
            pending.removeAll()
        case "state":
            if let data = json?.data(using: .utf8), let decoded = try? JSONDecoder().decode(StateEvent.self, from: data) { onState?(decoded.state) }
        case "conversation": if let json { onTranscript?(.conversation, json) }
        case "conversationContext": if let json { onTranscript?(.context, json) }
        default: break
        }
    }
}
