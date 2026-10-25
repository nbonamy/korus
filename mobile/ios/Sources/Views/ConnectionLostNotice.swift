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
    @Environment(AppModel.self) private var model
    let reconnect: () -> Void
    @State private var showingConnections = false

    var body: some View {
        ContentUnavailableView {
            Label("Connection lost", systemImage: "wifi.exclamationmark")
        } description: {
            if !model.connectionDetail.isEmpty { Text(model.connectionDetail).textSelection(.enabled) }
        } actions: {
            Button("Reconnect", action: reconnect).buttonStyle(.borderedProminent)
            Button("Connections") { showingConnections = true }
        }
        .fullScreenCover(isPresented: $showingConnections) { SettingsView() }
    }
}
