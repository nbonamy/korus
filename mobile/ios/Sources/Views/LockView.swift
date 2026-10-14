import SwiftUI

/// Covers the app while it is locked, and whenever it is not in front (so the app switcher shows nothing of the conversations).
struct LockView: View {
    @Environment(AppModel.self) private var model
    let lock: AppLock
    /// Out of sight only, not locked: nothing to press.
    let showsUnlock: Bool

    var body: some View {
        ZStack {
            Rectangle().fill(.background).ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "lock.fill").font(.system(size: 34, weight: .light)).foregroundStyle(.secondary)
                Text(model.productName).font(.title2.weight(.semibold))
                if showsUnlock {
                    Button { Task { await lock.unlock() } } label: {
                        Label("Unlock", systemImage: "faceid").font(.body.weight(.semibold)).padding(.horizontal, 12).frame(height: 44)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(lock.isAuthenticating)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
