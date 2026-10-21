import SwiftUI

struct ConnectionLostNotice: View {
    let reconnect: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
            Text("Offline · showing saved conversation")
            Spacer()
            Button("Reconnect", action: reconnect)
                .foregroundStyle(Color.accentColor)
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
}

struct ConnectionLostView: View {
    let reconnect: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Connection lost", systemImage: "wifi.exclamationmark")
        } actions: {
            Button("Reconnect", action: reconnect)
        }
    }
}
