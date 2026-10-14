import XCTest
@testable import CompanionConversation

final class ExternalLinkTests: XCTestCase {
    func testWebLinksKeepTheirCompleteDestination() throws {
        for value in ["https://example.com/docs?q=hello#section", "http://localhost:3000", "HTTPS://example.com/path"] {
            XCTAssertEqual(try XCTUnwrap(ExternalLink.url(value)).absoluteString, value)
        }
    }

    func testMailAndPhoneLinksUseTheirSystemHandlers() {
        XCTAssertNotNil(ExternalLink.url("mailto:hello@example.com"))
        XCTAssertNotNil(ExternalLink.url("tel:+15555550100"))
    }

    func testLocalExecutableAndMalformedLinksCannotLeaveTheTranscript() {
        for value in ["file:///private/notes.txt", "/workspace/readme.md", "companion://app/transcript.html", "javascript:alert(1)", "data:text/html,hello", "custom://action", "https:", "https:///", "mailto:", "tel:", "", "#section"] {
            XCTAssertNil(ExternalLink.url(value), value)
        }
    }
}
