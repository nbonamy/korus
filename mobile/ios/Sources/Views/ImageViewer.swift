import SwiftUI
import ImageIO

struct ImageViewer: View {
    let preview: ImagePreview
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                ZoomableImage(image: image, label: preview.title).ignoresSafeArea()
            } else if failed {
                ContentUnavailableView {
                    Label("Image unavailable", systemImage: "photo")
                } description: { Text("The image couldn’t be loaded.") } actions: {
                    Button("Retry") { attempt += 1 }
                }
            } else { ProgressView("Loading image…") }
        }
        .preferredColorScheme(.dark)
        .safeAreaInset(edge: .top) {
            HStack {
                Text(preview.title).font(.headline).lineLimit(1)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.headline).frame(width: 44, height: 44)
                        .background(.regularMaterial, in: .circle)
                }.accessibilityLabel("Close image")
            }.foregroundStyle(.white).padding(.horizontal).padding(.top, 4)
        }
        .task(id: attempt) {
            failed = false
            do {
                let loaded = try await ImagePreviewLoader.load(preview.source)
                guard !Task.isCancelled else { return }
                image = loaded
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

nonisolated enum ImagePreviewLoader {
    static func load(_ source: ImagePreview.Source) async throws -> UIImage {
        let data: Data
        switch source {
        case .data(let bytes): data = bytes
        case .remote(let url):
            let session = URLSession(configuration: .ephemeral)
            defer { session.invalidateAndCancel() }
            let (bytes, response) = try await session.bytes(for: URLRequest(url: url, timeoutInterval: 30))
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                  response.mimeType?.hasPrefix("image/") == true,
                  response.expectedContentLength <= Int64(ImagePreview.Source.maxBytes) else { throw URLError(.cannotDecodeContentData) }
            var result = Data()
            for try await byte in bytes {
                guard result.count < ImagePreview.Source.maxBytes else { throw URLError(.dataLengthExceedsMaximum) }
                result.append(byte)
            }
            data = result
        case .unavailable: throw URLError(.unsupportedURL)
        }
        return try await Task.detached(priority: .userInitiated) {
            guard data.count <= ImagePreview.Source.maxBytes,
                  let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 4096,
                  ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
            return UIImage(cgImage: image)
        }.value
    }
}

struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    let label: String
    func makeUIView(context: Context) -> ImageScrollView { ImageScrollView(image: image, label: label) }
    func updateUIView(_ view: ImageScrollView, context: Context) {}
}

/// UIKit owns pinch/pan, bounce and gesture arbitration. Double tap toggles a useful zoom level.
final class ImageScrollView: UIScrollView, UIScrollViewDelegate {
    private let picture: UIImageView
    private var previousSize = CGSize.zero
    init(image: UIImage, label: String) {
        picture = UIImageView(image: image)
        super.init(frame: .zero)
        delegate = self
        showsHorizontalScrollIndicator = false; showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        addSubview(picture)
        picture.isAccessibilityElement = true
        picture.accessibilityLabel = label
        picture.accessibilityHint = "Pinch or double tap to zoom."
        let tap = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        tap.numberOfTapsRequired = 2
        addGestureRecognizer(tap)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != previousSize, bounds.width > 0, bounds.height > 0, let size = picture.image?.size {
            previousSize = bounds.size
            let fit = min(bounds.width / size.width, bounds.height / size.height)
            minimumZoomScale = fit; maximumZoomScale = fit * 6
            zoomScale = fit
        }
        centerImage()
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { picture }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }
    private func centerImage() {
        contentInset = UIEdgeInsets(top: max(0, (bounds.height - contentSize.height) / 2), left: max(0, (bounds.width - contentSize.width) / 2), bottom: 0, right: 0)
    }
    @objc private func doubleTap(_ gesture: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale * 1.1 { setZoomScale(minimumZoomScale, animated: true) }
        else {
            let point = gesture.location(in: picture)
            let scale = minimumZoomScale * 3
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }
}
