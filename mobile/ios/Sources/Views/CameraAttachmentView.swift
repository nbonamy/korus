import AVFoundation
import SwiftUI

/// Camera access is requested only after Take Photo. Captures are returned to the draft, never sent.
struct CameraAttachmentView: View {
    let completed: (UIImage?) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var ready = false
    @State private var message: String?
    @State private var denied = false

    var body: some View {
        Group {
            if ready {
                CameraCapture(completed: completed).ignoresSafeArea()
            } else {
                NavigationStack {
                    Group {
                        if let message {
                            ContentUnavailableView {
                                Label("Camera unavailable", systemImage: "camera")
                            } description: { Text(message) } actions: {
                                if denied, let url = URL(string: UIApplication.openSettingsURLString) {
                                    Link("Open Settings", destination: url)
                                }
                                Button("Back to message") { completed(nil) }
                            }
                        } else { ProgressView("Opening camera…") }
                    }
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { completed(nil) } } }
                }
            }
        }
        .task { await prepare() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await prepare() } } }
    }

    @MainActor private func prepare() async {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            message = "This device has no available camera. You can add a photo from your library instead."
            return
        }
        var permission = AVCaptureDevice.authorizationStatus(for: .video)
        if permission == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            permission = AVCaptureDevice.authorizationStatus(for: .video)
        }
        guard !Task.isCancelled else { return }
        denied = permission == .denied
        ready = permission == .authorized
        if !ready {
            message = denied ? "Allow camera access in Settings to take a photo." : "Camera access is restricted on this device."
        }
    }
}

struct CameraCapture: UIViewControllerRepresentable {
    let completed: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completed: completed) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completed: (UIImage?) -> Void
        private var finished = false
        init(completed: @escaping (UIImage?) -> Void) { self.completed = completed }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            finish(info[.originalImage] as? UIImage)
        }
        private func finish(_ image: UIImage?) {
            guard !finished else { return }
            finished = true
            completed(image)
        }
    }
}
