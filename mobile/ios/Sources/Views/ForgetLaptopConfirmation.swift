import SwiftUI

extension View {
    /// Asks before removing a laptop from this phone, and does so once confirmed.
    func forgetLaptopConfirmation(_ laptop: Binding<EngineState.Laptop?>, forget: @escaping (EngineState.Laptop) -> Void) -> some View {
        alert("Forget this laptop?", isPresented: Binding(get: { laptop.wrappedValue != nil }, set: { if !$0 { laptop.wrappedValue = nil } })) {
            if let target = laptop.wrappedValue {
                Button("Forget Laptop", role: .destructive) { forget(target); laptop.wrappedValue = nil }
            }
            Button("Cancel", role: .cancel) { laptop.wrappedValue = nil }
        } message: {
            Text("\(laptop.wrappedValue?.name ?? "This laptop") will be removed from this phone. You will need a new pairing code to connect again.")
        }
    }
}
