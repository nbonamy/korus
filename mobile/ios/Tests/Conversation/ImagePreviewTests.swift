import Foundation
import XCTest
@testable import CompanionConversation

final class ImagePreviewTests: XCTestCase {
    func testDisplayedImageBytesAndCompleteWebDestinationsAreAccepted() throws {
        guard case .data(let bytes) = ImagePreview.Source("data:image/png;base64,aGVsbG8=") else { return XCTFail("Expected decoded image bytes") }
        XCTAssertEqual(bytes, Data("hello".utf8))
        let address = "https://example.com/image.png?signature=test#image"
        guard case .remote(let url) = ImagePreview.Source(address) else { return XCTFail("Expected web image") }
        XCTAssertEqual(url.absoluteString, address)
    }

    func testViewerCannotReadDeviceOrLaptopPathsOrExecutableSources() {
        for value in ["/Users/person/private.jpg", "file:///private/image.png", "companion://app/engine.html", "javascript:alert(1)", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,???", "data:image/png;base64,", "https:", "https://user:password@example.com/private.png", "blob:opaque"] {
            guard case .unavailable = ImagePreview.Source(value) else { XCTFail(value); continue }
        }
    }

    func testOversizedInlineImageIsRejectedBeforeDecoding() {
        let oversized = "data:image/png;base64," + String(repeating: "A", count: 26_666_672)
        guard case .unavailable = ImagePreview.Source(oversized) else { return XCTFail("Expected bounded image payload") }
    }
}
