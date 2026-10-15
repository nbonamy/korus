import SwiftUI

extension View {
    /// Opaque, adaptive content keeps sheets readable over a busy conversation.
    func appSheetSurface() -> some View {
        self
            .presentationBackground(Color(.systemGroupedBackground))
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .toolbarBackground(Color(.systemGroupedBackground), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }

    func appSheetFooter() -> some View {
        self
            .padding()
            .frame(maxWidth: .infinity)
            .background(Color(.systemGroupedBackground))
            .overlay(alignment: .top) { Divider() }
    }
}

/// Opaque white content on a light neutral canvas, with adaptive dark equivalents.
struct AppSheetList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        List {
            content.listRowBackground(Color(.secondarySystemGroupedBackground))
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
    }
}

/// A single layout for operations that replace a sheet's form while in flight.
struct AppSheetProgress: View {
    let title: String
    let symbol: String
    let message: String
    var subject: String? = nil
    var branch: String? = nil

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 420
            VStack(spacing: compact ? 16 : 24) {
                Spacer(minLength: 0)
                Image(systemName: symbol)
                    .font(.system(size: compact ? 28 : 34, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: compact ? 64 : 80, height: compact ? 64 : 80)
                    .background(Color.accentColor, in: .rect(cornerRadius: compact ? 18 : 22))
                    .accessibilityHidden(true)
                VStack(spacing: 10) {
                    Text(title).font(.title2.weight(.semibold))
                    if let subject, !subject.isEmpty { Text(subject).font(.body).lineLimit(3) }
                    if let branch, !branch.isEmpty {
                        Label(branch, systemImage: "arrow.triangle.branch").font(.subheadline).lineLimit(3)
                    }
                    Text(message).font(.subheadline).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                ProgressView().controlSize(.large).padding(.top, compact ? 12 : 16).accessibilityLabel(title)
                Spacer(minLength: 0)
                if !compact { Spacer().frame(height: 32) }
            }
            .padding(compact ? 24 : 28).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
