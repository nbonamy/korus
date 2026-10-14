import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import ImageIO

struct AttachmentPicker: UIViewControllerRepresentable {
    enum Source { case photos, files }
    let source: Source
    let limit: Int
    let pickedPhotos: ([NSItemProvider]) -> Void
    let pickedFiles: ([URL]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIViewController {
        switch source {
        case .photos:
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = .images
            config.selectionLimit = max(1, limit)
            config.preferredAssetRepresentationMode = .compatible
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = context.coordinator
            return picker
        case .files:
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = context.coordinator
            return picker
        }
    }
    func updateUIViewController(_ view: UIViewController, context: Context) {}
    final class Coordinator: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
        let parent: AttachmentPicker
        init(_ parent: AttachmentPicker) { self.parent = parent }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) { parent.pickedPhotos(results.map(\.itemProvider)) }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { parent.pickedFiles(urls) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { parent.pickedFiles([]) }
    }
}

/// Reads only picker-provided URLs or explicitly pasted providers; never sends a device filesystem path.
nonisolated enum AttachmentLoader {
    enum Failure: LocalizedError {
        case unreadable, tooLarge
        var errorDescription: String? {
            switch self {
            case .unreadable: "Couldn’t read that attachment. Try selecting it again."
            case .tooLarge: "That file is too large. Attachments must total 2.5 MB or less."
            }
        }
    }

    static func file(_ url: URL) throws -> ComposerAttachment {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        if type?.conforms(to: .image) == true {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw Failure.unreadable }
            return try photo(source, name: url.lastPathComponent)
        }
        guard (try url.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { throw Failure.unreadable }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 2_500_001) ?? Data()
        guard data.count <= 2_500_000 else { throw Failure.tooLarge }
        return ComposerAttachment(name: String(url.lastPathComponent.prefix(100)), mimeType: type?.preferredMIMEType ?? "application/octet-stream", type: .file, data: data)
    }

    static func photoProvider(_ provider: NSItemProvider) async throws -> ComposerAttachment {
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) else { throw Failure.unreadable }
        let name = provider.suggestedName ?? "Photo"
        // Provider URLs are valid only during the completion callback.
        let fromFile: ComposerAttachment? = try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else { continuation.resume(returning: nil); return }
                do {
                    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw Failure.unreadable }
                    continuation.resume(returning: try photo(source, name: name))
                } catch { continuation.resume(throwing: error) }
            }
        }
        if let fromFile { return fromFile }
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: type) { data, _ in
                do {
                    guard let data, data.count <= 50_000_000, let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw Failure.unreadable }
                    continuation.resume(returning: try photo(source, name: name))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private static func photo(_ source: CGImageSource, name: String) throws -> ComposerAttachment {
        for dimension in [2048, 1536, 1024] {
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: dimension, kCGImageSourceShouldCacheImmediately: true]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw Failure.unreadable }
            let size = CGSize(width: image.width, height: image.height)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                UIImage(cgImage: image).draw(in: CGRect(origin: .zero, size: size))
            }
            for quality in [0.85, 0.65, 0.45] {
                if let data = rendered.jpegData(compressionQuality: quality), data.count <= 500_000 {
                    let base = (name as NSString).deletingPathExtension
                    return ComposerAttachment(name: String((base.isEmpty ? "Photo" : base).prefix(90)) + ".jpg", mimeType: "image/jpeg", type: .image, data: data)
                }
            }
        }
        throw Failure.tooLarge
    }
}
