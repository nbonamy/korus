import SwiftUI

/// A quiet, branded arrival while the saved connection is restored.
struct StartupView: View {
    let productName: String
    let connecting: Bool
    private static let mark = Bundle.main.url(forResource: "icon", withExtension: "png")
        .flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 24) {
                if let mark = Self.mark {
                    Image(uiImage: mark)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 112, height: 112)
                        .clipShape(.rect(cornerRadius: 28, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 24, y: 12)
                        .accessibilityHidden(true)
                }
                Text(productName)
                    .font(.system(size: 34, weight: .semibold))
                    .tracking(-0.8)
            }
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(connecting ? "Connecting to your laptop…" : "Opening your workspace…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 44)
            Spacer()
            Spacer().frame(height: 64)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            RadialGradient(colors: [Color(.secondarySystemBackground), Color(.systemBackground)],
                           center: UnitPoint(x: 0.5, y: 0.42), startRadius: 0, endRadius: 360)
                .ignoresSafeArea()
        }
    }
}
