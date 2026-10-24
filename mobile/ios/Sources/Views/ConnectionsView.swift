import SwiftUI

struct ConnectionsView: View {
    @Environment(AppModel.self) private var model
    let closeSettings: () -> Void
    @State private var forgetting: EngineState.Laptop?

    var body: some View {
        AppSheetList {
            Section {
                ForEach(model.laptops, id: \.id) { laptop in
                    HStack {
                        Button {
                            if laptop.id != model.laptopID { model.command("connect", ["laptopId": laptop.id]) }
                            else if model.connection != .connected { model.reconnect() }
                            closeSettings()
                        } label: {
                            HStack {
                                Image(systemName: "laptopcomputer").foregroundStyle(Color.accentColor)
                                Text(laptop.name).foregroundStyle(.primary)
                                Spacer()
                                if laptop.id == model.laptopID {
                                    Label("Current", systemImage: "checkmark")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Menu {
                            Button("Forget connection", systemImage: "trash", role: .destructive) { forgetting = laptop }
                        } label: {
                            Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("Manage \(laptop.name)")
                    }
                }
                if model.showConnectionLost { ConnectionLostNotice(reconnect: model.reconnect) }
            }
            Section {
                Button("Add connection", systemImage: "plus") {
                    model.command("chooseConnection")
                    closeSettings()
                }
            }
        }
        .navigationTitle("Connections")
        .navigationBarTitleDisplayMode(.inline)
        .forgetLaptopConfirmation($forgetting) { laptop in
            model.command("forget", ["laptopId": laptop.id])
            if laptop.id == model.laptopID { closeSettings() }
        }
    }
}

extension View {
    /// Asks before removing a laptop from this phone, and does so once confirmed.
    func forgetLaptopConfirmation(_ laptop: Binding<EngineState.Laptop?>, forget: @escaping (EngineState.Laptop) -> Void) -> some View {
        confirmationDialog("Forget this laptop?", isPresented: Binding(get: { laptop.wrappedValue != nil }, set: { if !$0 { laptop.wrappedValue = nil } }), titleVisibility: .visible) {
            if let target = laptop.wrappedValue {
                Button("Forget Laptop", role: .destructive) { forget(target); laptop.wrappedValue = nil }
            }
        } message: {
            Text("\(laptop.wrappedValue?.name ?? "This laptop") will be removed from this phone. You will need a new pairing code to connect again.")
        }
    }
}
