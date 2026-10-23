import SwiftUI

/// First run, or after forgetting a laptop: enter or scan the code shown by the laptop.
struct PairingView: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var scannerOpen = false
    @State private var scannedCode: String?
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
                HStack(spacing: 0) {
                    Color.clear.frame(width: 48, height: 1).accessibilityHidden(true)
                    TextField("XXXX-XXXX", text: $code)
                        .font(.system(size: 26, weight: .semibold, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .accessibilityLabel("Pairing code")
                        .onChange(of: code) { _, value in
                            let formatted = PairingCode.format(value)
                            if formatted != value { code = formatted; return }
                            if PairingCode.isComplete(formatted), model.pairing == .idle {
                                focused = false
                                model.pair(code: formatted)
                            }
                        }
                    Button {
                        focused = false
                        scannerOpen = true
                    } label: {
                        Image(systemName: "camera")
                            .font(.system(size: 22))
                            .frame(width: 48, height: 56)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Scan laptop QR code")
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 6)
                .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
                .disabled(model.pairing != .idle)
                if let url = model.privacyPolicyURL {
                    Link("Privacy Policy", destination: url).font(.footnote)
                }
            }
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .onAppear { focused = true }
        .sheet(isPresented: $scannerOpen, onDismiss: {
            guard let scanned = scannedCode else { return }
            scannedCode = nil
            guard model.pairing == .idle else { return }
            if code == scanned { model.pair(code: scanned) }
            else { code = scanned }
        }) {
            PairingScannerView { scanned in
                scannedCode = scanned
                scannerOpen = false
            }
        }
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
