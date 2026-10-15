#if os(iOS)
import SwiftUI
import UIKit

/// A separate scene window covers UIKit presentations as well as the SwiftUI shell.
@MainActor
final class AppLockWindow: UIWindow {
    override init(frame: CGRect) {
        super.init(frame: frame)
        windowLevel = .alert + 1
        accessibilityViewIsModal = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func cover(with controller: UIViewController?) {
        if let controller {
            if rootViewController !== controller { rootViewController = controller }
            isHidden = false
            layoutIfNeeded()
        } else {
            isHidden = true
            rootViewController = nil
        }
    }
}

/// Attaches protection to the same scene without taking key-window ownership from the app.
struct AppLockCover<Content: View>: UIViewRepresentable {
    let visible: Bool
    let content: Content

    func makeCoordinator() -> Coordinator { Coordinator(content: content) }
    func makeUIView(context: Context) -> SceneAnchor {
        let view = SceneAnchor()
        view.changed = { [weak coordinator = context.coordinator] scene in coordinator?.update(scene) }
        return view
    }
    func updateUIView(_ view: SceneAnchor, context: Context) {
        context.coordinator.visible = visible
        context.coordinator.content = content
        context.coordinator.update(view.window?.windowScene)
    }
    static func dismantleUIView(_ view: SceneAnchor, coordinator: Coordinator) {
        view.changed = nil
        coordinator.update(nil)
    }

    final class SceneAnchor: UIView {
        var changed: ((UIWindowScene?) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); changed?(window?.windowScene) }
    }

    @MainActor
    final class Coordinator {
        var visible = false
        var content: Content
        private var cover: AppLockWindow?
        private var host: UIHostingController<Content>?
        init(content: Content) { self.content = content }

        func update(_ scene: UIWindowScene?) {
            guard visible, let scene else {
                cover?.cover(with: nil); cover = nil; host = nil
                return
            }
            if cover?.windowScene !== scene {
                cover?.cover(with: nil)
                let window = AppLockWindow(frame: scene.coordinateSpace.bounds)
                window.windowScene = scene
                cover = window
            }
            if let host { host.rootView = content }
            else { host = UIHostingController(rootView: content) }
            // A keyboard must not remain above the privacy cover in the app switcher.
            for window in scene.windows where window !== cover { window.endEditing(true) }
            cover?.cover(with: host)
        }
    }
}
#endif
