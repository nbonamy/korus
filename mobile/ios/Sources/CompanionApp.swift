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
                .background {
                    AppLockCover(visible: lock.isProtecting && lock.isLocked,
                                 content: LockView(lock: lock).environment(model))
                        .allowsHitTesting(false)
                }
                .task { await lock.unlock() }
                .onOpenURL { model.openActivity($0) }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background:
                        lock.didLeave()
                        model.setActive(false)
                    case .active:
                        lock.didReturn()
                        model.setUnlocked(!lock.isLocked)
                        model.setActive(true)
                        if lock.isLocked { Task { await lock.unlock() } }
                    default: break
                    }
                }
                // The link to the laptop is held only while the screen can be seen.
                .onChange(of: lock.isLocked, initial: true) { _, locked in
                    model.setUnlocked(!locked)
                }
        }
    }
}
