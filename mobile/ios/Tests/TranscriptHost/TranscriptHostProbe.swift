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
    func frame(_ revision: Int, generation: Int = 1, ready: Bool = true) -> String {
        let agent: [String: Any] = ["id": "transcript-probe", "teamId": "test-team", "name": "Transcript test", "backend": "codex", "status": ["type": "working"], "readState": ["revision": revision, "readRevision": 0]]
        let message: [String: Any] = ["id": "message", "role": "assistant", "status": "complete", "parts": [["type": "text", "text": "Rendered test content \(revision)"]]]
        let snapshot: [String: Any] = ["messages": [message], "turns": [], "activeTurnId": NSNull(), "busy": false]
        let object: [String: Any] = ["agent": agent, "agentId": "transcript-probe", "generation": generation, "ready": ready, "peers": [], "history": ["hasOlder": false, "loadingOlder": false, "failed": false], "frame": ["agentId": "transcript-probe", "backend": "codex", "payload": ["snapshot": snapshot]]]
        return String(data: try! JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
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

    func run() async {
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
        if let locked = await entryImage(LockView(lock: lock, showsUnlock: true).environment(AppModel()), name: "lock-locked.png"),
           let covered = await entryImage(LockView(lock: lock, showsUnlock: false).environment(AppModel()), name: "lock-covered.png"),
           let connecting = await entryImage(StartupView(productName: "Korus", connecting: true), name: "connecting.png") {
            let header = CGRect(x: 0, y: 0, width: locked.width, height: locked.height / 2)
            let lockedHeader = locked.cropping(to: header).map { UIImage(cgImage: $0).pngData() }
            let coveredHeader = covered.cropping(to: header).map { UIImage(cgImage: $0).pngData() }
            check(lockedHeader != nil && lockedHeader == coveredHeader, "branding stays in place when the unlock button hides")
            let connectingHeader = connecting.cropping(to: header).map { UIImage(cgImage: $0).pngData() }
            check(lockedHeader != nil && lockedHeader == connectingHeader, "unlock and connecting screens share the same logo and title position")
            check(UIImage(cgImage: locked).pngData() != UIImage(cgImage: covered).pngData(), "privacy cover hides the unlock button")
        } else {
            check(false, "lock screen renders for the layout regression")
        }
        window?.rootViewController = conversationController
        for _ in 0..<100 {
            if await js("Boolean(window.companionTranscript)") as? Bool == true { break }
            await pause(100)
        }
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
