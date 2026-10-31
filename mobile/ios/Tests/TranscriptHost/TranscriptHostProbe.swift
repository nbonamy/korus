import UIKit
import WebKit
import SwiftUI
import Observation

/// Runs the production host, loading state and bundled transcript in an isolated simulator app.
@main
@MainActor
final class TranscriptHostProbe: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    let host = TranscriptHost()
    var loading = ConversationLoadingState()
    var receipts = 0
    var lastReceipt: (revision: Int, generation: Int)?
    var checks: [[String: Any]] = []

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Transcript tests", sessionRole: session.role)
        configuration.delegateClass = TranscriptProbeScene.self
        return configuration
    }

    func start(_ scene: UIWindowScene) {
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        host.webView.frame = controller.view.bounds
        host.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        controller.view.addSubview(host.webView)
        self.window = window
        window.makeKeyAndVisible()
        host.onRendered = { [weak self] id, revision, generation in
            guard let self, id == "transcript-probe" else { return }
            self.receipts += 1
            self.lastReceipt = (revision, generation)
            self.loading.rendered()
        }
        host.onRenderFailed = { [weak self] in self?.loading.renderingFailed() }
        Task { await run() }
    }

    func pause(_ milliseconds: UInt64) async { try? await Task.sleep(nanoseconds: milliseconds * 1_000_000) }
    func js(_ script: String) async -> Any? { try? await host.webView.evaluateJavaScript(script) }
    func wait(_ predicate: () -> Bool, milliseconds: Int = 3000) async {
        for _ in 0..<(milliseconds / 50) {
            if predicate() { return }
            await pause(50)
        }
    }
    func check(_ condition: Bool, _ name: String) {
        checks.append(["name": name, "passed": condition])
        print("TRANSCRIPT_NATIVE \(condition ? "PASS" : "FAIL") \(name)")
    }
    func select() {
        loading.select()
        host.beginSelection()
        loading.update(fetching: true, failed: false, hasAgent: true)
        loading.update(fetching: false, failed: false, hasAgent: true)
    }
    func frame(_ revision: Int, generation: Int = 1, ready: Bool = true, text: String? = nil) -> String {
        let agent: [String: Any] = ["id": "transcript-probe", "teamId": "test-team", "name": "Transcript test", "backend": "codex", "status": ["type": "working"], "readState": ["revision": revision, "readRevision": 0]]
        let message: [String: Any] = ["id": "message", "role": "assistant", "status": "complete", "parts": [["type": "text", "text": text ?? "Rendered test content \(revision)"]]]
        let snapshot: [String: Any] = ["messages": [message], "turns": [], "activeTurnId": NSNull(), "busy": false]
        let object: [String: Any] = ["agent": agent, "agentId": "transcript-probe", "generation": generation, "ready": ready, "peers": [], "history": ["hasOlder": false, "loadingOlder": false, "failed": false], "frame": ["agentId": "transcript-probe", "backend": "codex", "payload": ["snapshot": snapshot]]]
        return String(data: try! JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
    }
    func transferChecks() async {
        var applied = 0
        var resets = 0
        func transfer(_ includeFrame: Bool) -> String {
            let agent: [String: Any] = ["id": "transcript-probe", "teamId": "test-team", "name": "Cached conversation", "backend": "claude", "backendSession": ["kind": "claude", "sessionId": "probe-session"], "status": ["type": "idle"]]
            let snapshot: [String: Any] = ["agentId": "transcript-probe", "sessionId": "probe-session", "messages": [["id": "cached-answer", "agentId": "transcript-probe", "role": "assistant", "status": "complete", "parts": [["type": "text", "text": "Retained native conversation"]]]], "turns": [], "turnIds": [], "activeTurnId": NSNull(), "busy": false, "historyLoading": false, "historyState": ["hasOlder": false, "loadingOlder": false], "answeredClientRequestIds": [], "contextUsage": NSNull(), "plan": NSNull(), "error": NSNull()]
            let frame: [String: Any] = ["type": "claude.conversationSnapshotChanged", "agentId": "transcript-probe", "backend": "claude", "payload": ["revision": 1, "snapshot": snapshot]]
            let message: [String: Any] = ["identity": "native-cached", "checkpoint": ["epoch": "native-epoch", "revision": 1], "agentId": "transcript-probe", "agent": agent, "generation": 1, "ready": true, "peers": [], "frames": includeFrame ? [frame] : []]
            return String(data: try! JSONSerialization.data(withJSONObject: message), encoding: .utf8)!
        }
        host.onTransferApplied = { identity, checkpoint in if identity == "native-cached" && checkpoint["revision"] as? Int == 1 { applied += 1 } }
        host.onNeedsReset = { [weak self] identity in
            guard identity == "native-cached" else { return }
            resets += 1
            self?.host.submit(.transfer, transfer(true))
        }
        host.submit(.transfer, transfer(true))
        await wait { applied == 1 }
        check(applied == 1, "native bridge acknowledges the retained provider checkpoint after paint")
        host.beginSelection()
        host.submit(.transfer, transfer(false))
        await wait { applied == 2 }
        let visible = await js("document.body.textContent.includes('Retained native conversation')") as? Bool ?? false
        check(applied == 2 && visible, "cached native selection paints without retransmitting the conversation")
        host.retry()
        await wait({ applied >= 3 }, milliseconds: 6000)
        check(resets == 1 && applied >= 3, "reloaded WebView requests and paints a fresh baseline instead of accepting an absent cache")
        host.onTransferApplied = nil
        host.onNeedsReset = nil
    }

    func retry(_ revision: Int) async {
        loading.select(awaitingRender: true)
        host.retry()
        // A cached re-selection can produce no engine events at all.
        loading.update(fetching: false, failed: false, hasAgent: true)
        await wait { !self.loading.isLoading }
        let content = await js("document.body.textContent.includes('Rendered test content \(revision)')") as? Bool ?? false
        check(!loading.isLoading && !loading.failed && content, "retry reloads and replays the cached transcript without a new engine frame")
    }

    // Failure modes: accepting into a nonempty draft, swallowing normal typing,
    // stale native text after acceptance, or a cursor left before the inserted text.
    func checkComposerSuggestions() async {
        let suggestion = "Review the changes 🦞"
        for (initial, input, proposed, expected) in [
            ("", " ", suggestion as String?, suggestion),
            ("My prompt", " ", suggestion as String?, "My prompt "),
            ("", "X", suggestion as String?, "X"),
            ("", " ", nil, " ")
        ] {
            var text = initial
            var caret: NSRange?
            let editor = ComposerEditor(text: Binding(get: { text }, set: { text = $0 }), chips: .constant([]),
                selection: Binding(get: { caret }, set: { caret = $0 }), focused: .constant(false), query: .constant(nil),
                suggestions: [], editable: true, maxLines: 1, placeholder: proposed ?? "Message", suggestedPrompt: proposed)
            let hosting = UIHostingController(rootView: editor)
            window!.rootViewController!.addChild(hosting)
            hosting.view.frame = CGRect(x: 0, y: 100, width: 350, height: 60)
            window!.rootViewController!.view.addSubview(hosting.view)
            hosting.didMove(toParent: window!.rootViewController)
            await pause(80)
            func findEditor(_ view: UIView) -> ComposerTextView? {
                if let editor = view as? ComposerTextView { return editor }
                return view.subviews.compactMap { findEditor($0) }.first
            }
            if let view = findEditor(hosting.view) {
                check(view.placeholder.text == (proposed ?? "Message") && view.document.text == initial, "composer shows suggestion without inserting it")
                view.insertText(input)
                if text != expected || view.document.text != expected || caret?.location != expected.utf16.count {
                    print("TRANSCRIPT_NATIVE composer diagnostic draft=\(text.debugDescription) native=\(view.document.text.debugDescription) caret=\(String(describing: caret)) expected=\(expected.debugDescription)")
                }
                check(text == expected && view.document.text == expected && caret?.location == expected.utf16.count,
                    "composer space acceptance respects empty draft and cursor: \(initial.isEmpty)-\(input)-\(proposed != nil)")
            } else { check(false, "native composer is mounted") }
            hosting.willMove(toParent: nil); hosting.view.removeFromSuperview(); hosting.removeFromParent()
        }
    }

    func run() async {
        await checkComposerSuggestions()
        let lock = AppLock()
        let conversationController = window?.rootViewController
        func entryImage<Content: View>(_ content: Content, name: String) async -> CGImage? {
            let controller = UIHostingController(rootView: content.preferredColorScheme(.light))
            window?.rootViewController = controller
            await pause(250)
            controller.view.layoutIfNeeded()
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(bounds: controller.view.bounds, format: format).image { _ in
                controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
            }
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
            try? image.pngData()?.write(to: url)
            return image.cgImage
        }
        if ProcessInfo.processInfo.environment["APP_NATIVE_SKIP_SCREENSHOTS"] != "1" {
        if let locked = await entryImage(LockView(lock: lock).environment(AppModel()), name: "lock-locked.png"),
           let connecting = await entryImage(StartupView(productName: "Korus", connecting: true), name: "connecting.png") {
            let header = CGRect(x: 0, y: 0, width: locked.width, height: locked.height / 2)
            let lockedHeader = locked.cropping(to: header).map { UIImage(cgImage: $0).pngData() }
            let connectingHeader = connecting.cropping(to: header).map { UIImage(cgImage: $0).pngData() }
            check(lockedHeader != nil && lockedHeader == connectingHeader, "unlock and connecting screens share the same logo and title position")
        } else {
            check(false, "lock screen renders for the layout regression")
        }
        }
        window?.rootViewController = conversationController
        for _ in 0..<100 {
            if await js("Boolean(window.companionTranscript)") as? Bool == true { break }
            await pause(100)
        }
        await transferChecks()
        select()
        host.submit(.conversation, frame(1))
        await wait { !self.loading.isLoading }
        check(!loading.isLoading && !loading.failed, "initial conversation paints successfully")
        let synchronizedReceipts = receipts
        host.submit(.conversation, frame(40, generation: 2, ready: false))
        await pause(300)
        let retained = await js("document.body.textContent.includes('Rendered test content 40')") as? Bool ?? false
        check(retained && receipts == synchronizedReceipts, "unsynchronized history stays visible without acknowledging a stale revision")
        host.submit(.conversation, frame(1, generation: 3))
        await wait { self.receipts > synchronizedReceipts }
        check(lastReceipt?.generation == 3 && lastReceipt?.revision == 1, "fresh rendering carries the connection generation even when its revision is lower")
        // Paint slower than the real engine's 100ms cadence. The WebView and native queue are real.
        _ = await js("window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 120)")
        select()
        let before = receipts
        for revision in 2...21 {
            host.submit(.conversation, frame(revision))
            await pause(100)
        }
        check(!loading.isLoading && receipts > before, "streaming does not invalidate receipts for the selected conversation")
        let rendered = await js("document.body.textContent.includes('Rendered test content')") as? Bool ?? false
        check(rendered, "loading clears only alongside actual rendered content")
        await pause(500)
        host.submit(.conversation, frame(22))
        await pause(20)
        select()
        await pause(400)
        check(loading.isLoading, "late receipts from the previous selection cannot reveal a new selection")
        host.submit(.conversation, frame(23))
        await wait { !self.loading.isLoading }
        check(!loading.isLoading, "a new selection renders without waiting for obsolete queue work")

        _ = await js("window.companionTranscript.setConversation = async () => { throw new Error('Injected render error') }")
        select()
        host.submit(.conversation, frame(24))
        await wait { self.loading.failed }
        check(loading.failed && !loading.isLoading, "JavaScript rendering errors release the spinner into a recoverable failure")
        loading.update(fetching: false, failed: false, hasAgent: true)
        check(loading.failed, "engine metadata updates do not erase rendering failures")
        await retry(24)

        host.webViewWebContentProcessDidTerminate(host.webView)
        check(loading.failed && !loading.isLoading, "WebKit process termination becomes a recoverable failure")
        await retry(24)

        _ = await js("window.companionTranscript.setConversation = async () => new Promise(() => {})")
        select()
        host.submit(.conversation, frame(27))
        await wait({ self.loading.failed }, milliseconds: 23000)
        check(loading.failed && !loading.isLoading, "a stalled render reaches the native deadline instead of loading forever")
        await retry(27)
        await pause(300)
        check(!loading.failed && !loading.isLoading, "obsolete render callbacks cannot fail the recovered page")

        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        var openedImage = false
        var imageReads = 0
        host.onReadContent = { [weak self] request in
            guard request["type"] as? String == "readConversationImage", let self else { return }
            imageReads += 1
            let response: [String: Any] = ["type": "conversationImage", "requestId": request["requestId"]!, "agentId": request["agentId"]!, "dataUrl": "data:image/png;base64,\(png)"]
            self.host.receiveContent(String(data: try! JSONSerialization.data(withJSONObject: response), encoding: .utf8)!)
        }
        host.onOpenImage = { agentID, image in
            if case .data(let bytes) = image.source { openedImage = agentID == "transcript-probe" && bytes == Data(base64Encoded: png) }
        }
        host.submit(.conversation, frame(28, text: "![Inline screenshot](/tmp/inline.png) [Screenshot](/tmp/shot.png)"))
        await wait { imageReads > 0 }
        await pause(300)
        let inlineImage = await js("Array.from(document.images).some(image => image.alt === 'Inline screenshot' && image.naturalWidth > 0)") as? Bool ?? false
        check(inlineImage, "inline laptop images resolve through the native image bridge")
        _ = await js("document.querySelector('a[href=\"/tmp/shot.png\"]').click()")
        await wait { openedImage }
        check(openedImage && imageReads >= 2, "ordinary image links deliver bytes to the native viewer without model-specific links")

        var fileOpen = false
        var fileReads = 0
        host.onFilePreviewVisibility = { fileOpen = $0 }
        host.onReadContent = { [weak self] request in
            guard request["type"] as? String == "readFilePreview", let self else { return }
            fileReads += 1
            let preview: [String: Any] = ["path": "src/app.swift", "source": ["path": "src/app.swift", "kind": "text", "size": 20, "content": "let nativeSource = true"],
                "diff": "diff --git a/src/app.swift b/src/app.swift\n--- a/src/app.swift\n+++ b/src/app.swift\n@@ -1 +1 @@\n-old\n+nativeChange\n", "diffScope": "turn"]
            let response: [String: Any] = ["type": "conversationFile", "requestId": request["requestId"]!, "agentId": request["agentId"]!, "preview": preview]
            self.host.receiveContent(String(data: try! JSONSerialization.data(withJSONObject: response), encoding: .utf8)!)
        }
        host.submit(.conversation, frame(29, text: "Read [app.swift](src/app.swift:1)"))
        await wait { self.lastReceipt?.revision == 29 }
        _ = await js("document.querySelector('a[href=\"src/app.swift:1\"]').click()")
        await wait { fileOpen && fileReads == 1 }
        await pause(200)
        let sourceVisible = await js("document.querySelector('[aria-label=\"File preview\"]')?.textContent.includes('nativeSource')") as? Bool ?? false
        check(fileOpen && sourceVisible, "file links traverse the real native bridge and show current source")
        _ = await js("document.querySelector('[aria-label=\"Show diff\"]').click()")
        await pause(150)
        let patchVisible = await js("document.querySelector('[aria-label=\"File preview\"]')?.textContent.includes('nativeChange')") as? Bool ?? false
        check(patchVisible && fileReads == 1, "Diff and Source reuse one native file response")
        _ = await js("window.companionTranscript.closeFile()")
        await wait { !fileOpen }
        check(!fileOpen, "closing a file preview restores native conversation chrome")

        let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("image-cache-probe")
        let imageCache = DeviceImageCache(directory: cacheRoot)
        let scope = String(repeating: "a", count: 64), imageKey = String(repeating: "1", count: 64)
        do {
            try await imageCache.write(host: scope, key: imageKey, dataUrl: "data:image/png;base64,\(png)")
            let cached = try await DeviceImageCache(directory: cacheRoot).read(host: scope, key: imageKey)
            check(cached == "data:image/png;base64,\(png)", "iOS cache bytes survive storage-owner recreation in the device cache directory")
            try await imageCache.forget(host: scope)
            let forgotten = try await imageCache.read(host: scope, key: imageKey)
            check(forgotten == nil, "forgetting the laptop removes its device image bytes")
        } catch { check(false, "native iOS image cache is available") }

        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("transcript-results.json")
        try! JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted, .sortedKeys]).write(to: url)
        print("TRANSCRIPT_NATIVE_DONE")
    }
}

/// The lock view only reads product branding from the model boundary.
@Observable
@MainActor
final class AppModel {
    var productName = "Korus"
}

@MainActor
final class TranscriptProbeScene: UIResponder, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene, let app = UIApplication.shared.delegate as? TranscriptHostProbe else { return }
        app.start(scene)
    }
}
