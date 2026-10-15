import AVFoundation
import SwiftUI
import VisionKit

struct PairingScannerView: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var ready = false
    @State private var message: String?
    @State private var permissionDenied = false

    var body: some View {
        NavigationStack {
            Group {
                if ready {
                    PairingCamera(active: scenePhase == .active, onCode: onCode) { error in
                        ready = false
                        message = error
                    }
                    .overlay(alignment: .bottom) {
                        Text("Point your camera at the QR code on your laptop.")
                            .font(.callout).multilineTextAlignment(.center)
                            .padding().background(.regularMaterial, in: .rect(cornerRadius: 16))
                            .padding()
                    }
                } else if let message {
                    ContentUnavailableView {
                        Label("Camera unavailable", systemImage: "camera")
                    } description: {
                        Text(message)
                    } actions: {
                        if permissionDenied, let url = URL(string: UIApplication.openSettingsURLString) {
                            Link("Open Settings", destination: url)
                        }
                        Button("Enter code manually") { dismiss() }
                    }
                } else {
                    ProgressView("Opening camera…")
                }
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .appSheetSurface()
        .task { await prepareCamera() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await prepareCamera() } }
        }
    }

    @MainActor private func prepareCamera() async {
        guard DataScannerViewController.isSupported else {
            message = "Scanning isn’t supported on this device. Enter the code shown on your laptop."
            return
        }
        var permission = AVCaptureDevice.authorizationStatus(for: .video)
        if permission == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            permission = AVCaptureDevice.authorizationStatus(for: .video)
        }
        guard !Task.isCancelled else { return }
        permissionDenied = permission == .denied
        ready = permission == .authorized && DataScannerViewController.isAvailable
        if !ready {
            message = permissionDenied
                ? "Allow camera access in Settings to scan, or enter the code manually."
                : "The camera is unavailable. Enter the code shown on your laptop."
        }
    }
}

private struct PairingCamera: UIViewControllerRepresentable {
    let active: Bool
    let onCode: (String) -> Void
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode, onError: onError) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if active && !context.coordinator.finished {
            guard !scanner.isScanning else { return }
            do { try scanner.startScanning() }
            catch { context.coordinator.fail(scanner) }
        } else {
            scanner.stopScanning()
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        coordinator.finished = true
        scanner.stopScanning()
        scanner.delegate = nil
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        let onError: (String) -> Void
        var finished = false
        private var scan = PairingScan()

        init(onCode: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
            self.onCode = onCode
            self.onError = onError
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            accept(addedItems, scanner: scanner)
        }

        func dataScanner(_ scanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            accept(updatedItems, scanner: scanner)
        }

        private func accept(_ items: [RecognizedItem], scanner: DataScannerViewController) {
            guard !finished else { return }
            for item in items {
                guard case .barcode(let barcode) = item,
                      let payload = barcode.payloadStringValue,
                      let code = scan.accept(payload) else { continue }
                finished = true
                scanner.stopScanning()
                onCode(code)
                return
            }
        }

        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            fail(scanner)
        }

        func fail(_ scanner: DataScannerViewController) {
            guard !finished else { return }
            finished = true
            scanner.stopScanning()
            DispatchQueue.main.async { self.onError("The camera is unavailable. Enter the code shown on your laptop.") }
        }
    }
}
