import SwiftUI

@main
struct CompanionApp: App {
    @UIApplicationDelegateAdaptor(CompanionAppDelegate.self) private var appDelegate
    @State private var model = AppModel()
    @State private var lock = AppLock()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(lock)
                .overlay {
                    // Locked, or not in front: the conversations are never visible behind a lock or in the app switcher.
                    if lock.isProtecting && (lock.isLocked || scenePhase != .active) {
                        LockView(lock: lock, showsUnlock: lock.isLocked).environment(model).transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.15), value: lock.isLocked)
                .task { await lock.unlock() }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background:
                        lock.didLeave()
                        model.setActive(false)
                    case .active:
                        lock.didReturn()
                        if lock.isLocked { Task { await lock.unlock() } } else { model.setActive(true) }
                    default: break
                    }
                }
                // The link to the laptop is held only while the screen can be seen.
                .onChange(of: lock.isLocked) { _, locked in
                    if !locked && scenePhase == .active { model.setActive(true) }
                }
        }
    }
}
