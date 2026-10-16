import SwiftUI

/// Covers the app when authentication is required; brief switches retain the unlocked screen.
struct LockView: View {
    @Environment(AppModel.self) private var model
    let lock: AppLock

    var body: some View {
        BrandedEntryView(productName: model.productName) {
            Button { Task { await lock.unlock() } } label: {
                Label("Unlock", systemImage: "faceid").font(.body.weight(.semibold)).padding(.horizontal, 12).frame(height: 44)
            }
            .buttonStyle(.glassProminent)
            .disabled(lock.isAuthenticating)
        }
        .accessibilityElement(children: .contain)
    }
}
