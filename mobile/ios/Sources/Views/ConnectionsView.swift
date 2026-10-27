import SwiftUI

struct ConnectionsView: View {
    @Environment(AppModel.self) private var model
    let closeSettings: () -> Void
    @State private var forgetting: EngineState.Laptop?
    @State private var renaming: EngineState.Laptop?
    @State private var newName = ""

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
                                Image(systemName: "laptopcomputer").foregroundStyle(.primary)
                                Text(laptop.name).foregroundStyle(.primary)
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if laptop.id == model.laptopID {
                            if model.showConnectionLost {
                                Button { model.reconnect() } label: {
                                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Reconnect to \(laptop.name)")
                            } else if model.connection == .connected {
                                Image(systemName: "checkmark").foregroundStyle(.secondary).accessibilityLabel("Current")
                            } else {
                                ProgressView().accessibilityLabel("Connecting to \(laptop.name)")
                            }
                        }
                        Menu {
                            Button("Rename", systemImage: "pencil") { newName = laptop.name; renaming = laptop }
                            if laptop.id == model.laptopID && model.showConnectionLost {
                                Button("Reconnect", systemImage: "arrow.clockwise") { model.reconnect() }
                            }
                            Button("Forget connection", systemImage: "trash", role: .destructive) { forgetting = laptop }
                        } label: {
                            Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("Manage \(laptop.name)")
                    }
                }
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
        .alert("Rename laptop", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Save") {
                if let laptop = renaming, let name = LaptopName.cleaned(newName) { model.command("renameLaptop", ["laptopId": laptop.id, "name": name]) }
                renaming = nil
            }
            .disabled(LaptopName.cleaned(newName) == nil)
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .forgetLaptopConfirmation($forgetting) { laptop in
            model.command("forget", ["laptopId": laptop.id])
            if laptop.id == model.laptopID { closeSettings() }
        }
    }
}
