import SwiftUI

/// Native interpretation of the generated glass-banner design; every control stays accessible.
struct NotificationBanner: View {
    let notification: ChatNotification
    let open: () -> Void
    let dismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var tint: Color { notification.kind == .completed ? .green : notification.kind == .approval ? .orange : .accentColor }

    var body: some View {
        HStack(spacing: 0) {
            Button(action: open) {
                HStack(spacing: 13) {
                    Text(notification.initials)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 42, height: 42)
                        .background(Color.accentColor.opacity(0.12), in: Circle())
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: notification.symbol)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white).frame(width: 19, height: 19)
                                .background(tint, in: Circle())
                                .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                                .offset(x: 3, y: 2)
                        }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(notification.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                        Text(notification.message).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 15)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(notification.name), \(notification.message)")
            .accessibilityHint("Open conversation")
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary).frame(width: 44, height: 52).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Dismiss notification")
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .shadow(color: .black.opacity(0.09), radius: 16, y: 7)
        .padding(.horizontal, 14).padding(.top, 8)
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .gesture(DragGesture(minimumDistance: 20).onEnded { if $0.translation.height < -20 { dismiss() } })
        .task(id: notification.id) {
            guard !voiceOver else { return }
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { dismiss() }
        }
    }
}
