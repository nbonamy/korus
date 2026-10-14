import SwiftUI

/// First run, or after forgetting a laptop: the only thing to do is type the code the laptop shows.
struct PairingView: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 40)
            VStack(spacing: 10) {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Color.accentColor)
                Text("Connect your laptop")
                    .font(.title.weight(.bold))
                Text("On your laptop, open Settings → Connections → Mobile access and choose Pair phone.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }

            if model.laptops.count > 1 || (model.laptops.count == 1 && model.connection != .connecting) {
                VStack(spacing: 8) {
                    ForEach(model.laptops, id: \.id) { laptop in
                        Button {
                            model.command("connect", ["laptopId": laptop.id])
                        } label: {
                            HStack {
                                Text(laptop.name).font(.headline)
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 18).frame(height: 56)
                            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if model.connection == .connecting || model.connection == .reconnecting {
                ProgressView("Connecting…").foregroundStyle(.secondary)
            }
            if model.connection == .error {
                Text("Laptop unavailable. Check it and the relay, then try again.").font(.footnote).foregroundStyle(.red)
            }
            Spacer()

            VStack(spacing: 12) {
                if !model.pairingError.isEmpty {
                    Text(Self.message(for: model.pairingError)).font(.footnote).foregroundStyle(.red)
                }
                if model.pairing == .awaitingApproval {
                    Label("Approve this phone on your laptop.", systemImage: "hourglass").font(.subheadline).foregroundStyle(.secondary)
                }
                TextField("XXXX-XXXX", text: $code)
                    .font(.system(size: 26, weight: .semibold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(.vertical, 18)
                    .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
                    .disabled(model.pairing != .idle)
                    .onChange(of: code) { _, value in
                        let formatted = PairingCode.format(value)
                        if formatted != value { code = formatted; return }
                        if PairingCode.isComplete(formatted) { model.pair(code: formatted) }
                    }
            }
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .onAppear { focused = true }
    }

    static func message(for key: String) -> String {
        switch key {
        case "mobile.errors.noLaptop": "No laptop is showing this code. Check it and try again."
        case "mobile.errors.codeMismatch": "That code did not match. Try again."
        case "mobile.errors.codeFormat": "Enter the 8-character code."
        case "mobile.errors.noRelay": "This build has no relay configured."
        case "mobile.errors.pairingExpired": "Pairing expired. Start again on your laptop."
        default: "Pairing failed. Check the code and try again."
        }
    }
}

/// Eight symbols from an alphabet without look-alikes, shown as two groups of four.
enum PairingCode {
    private static let alphabet = Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func format(_ input: String) -> String {
        let symbols = input.uppercased().filter { alphabet.contains($0) }.prefix(8)
        guard symbols.count > 4 else { return String(symbols) }
        return "\(symbols.prefix(4))-\(symbols.dropFirst(4))"
    }

    static func isComplete(_ formatted: String) -> Bool { formatted.filter { $0 != "-" }.count == 8 }
}
