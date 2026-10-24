import SwiftUI

private let entryMark = Bundle.main.url(forResource: "icon", withExtension: "png")
    .flatMap { UIImage(contentsOfFile: $0.path) }

/// A quiet, branded arrival while the saved connection is restored.
struct StartupView: View {
    let productName: String
    let connecting: Bool

    var body: some View {
        BrandedEntryView(productName: productName) {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(connecting ? "Connecting to your laptop…" : "Opening your workspace…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The product's icon, drawn the way the entry screens and settings show it.
struct BrandMark: View {
    let size: CGFloat

    var body: some View {
        if let mark = entryMark {
            Image(uiImage: mark)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: size / 4, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: size / 4.7, y: size / 9.3)
                .accessibilityHidden(true)
        }
    }
}

/// Keeps branding fixed while entry-screen actions change.
struct BrandedEntryView<Footer: View>: View {
    let productName: String
    @ViewBuilder let footer: Footer

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 24) {
                BrandMark(size: 112)
                Text(productName)
                    .font(.system(size: 34, weight: .semibold))
                    .tracking(-0.8)
            }
            footer.frame(height: 44)
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
