import Foundation
import XCTest
@testable import CompanionComposer

@MainActor
final class ComposerDraftTests: XCTestCase {
    private let first = ComposerTarget(hostId: "host", locationId: "local", teamId: "team", agentId: "a", sessionId: "one")
    private let second = ComposerTarget(hostId: "host", locationId: "local", teamId: "team", agentId: "b", sessionId: "two")
    private func photo(_ count: Int = 10) -> ComposerAttachment { .init(name: "Photo.jpg", mimeType: "image/jpeg", type: .image, data: Data(repeating: 1, count: count)) }

    func testGoalDraftSurvivesNavigationAndFailureAndExitsModeOnlyOnAcceptance() throws {
        let drafts = ComposerDrafts(); drafts.select(first)
        drafts.setGoalMode(true); drafts.text = "Ship the feature"
        XCTAssertNil(drafts.beginImport())
        let request = try XCTUnwrap(drafts.beginSend())
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertEqual(payload["goalMode"] as? Bool, true)
        drafts.completeSend(.init(requestId: request.requestId, status: .unknown))
        XCTAssertTrue(drafts.goalMode)
        XCTAssertEqual(drafts.text, "Ship the feature")
        XCTAssertNotNil(drafts.error)
        let retry = try XCTUnwrap(drafts.beginSend())
        drafts.select(second)
        XCTAssertFalse(drafts.goalMode)
        drafts.completeSend(.init(requestId: retry.requestId, status: .accepted))
        drafts.select(first)
        XCTAssertFalse(drafts.goalMode)
        XCTAssertEqual(drafts.text, "")
    }

    func testGoalModeCannotSilentlyDiscardAttachments() throws {
        let drafts = ComposerDrafts(); drafts.select(first)
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: [photo()])
        drafts.setGoalMode(true)
        XCTAssertFalse(drafts.goalMode)
        XCTAssertEqual(drafts.items.count, 1)
    }

    func testTextOnlySendToNewChatEncodesTheNullSessionRequiredByTheEngine() throws {
        let drafts = ComposerDrafts()
        drafts.select(ComposerTarget(hostId: "host", locationId: "local", teamId: "team", agentId: "new", sessionId: nil))
        drafts.text = "Hello"
        let request = try XCTUnwrap(drafts.beginSend())
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        let target = try XCTUnwrap(payload["target"] as? [String: Any])
        XCTAssertTrue(target["sessionId"] is NSNull, "The engine target uses null for a chat without a provider session")
        XCTAssertEqual(payload["text"] as? String, "Hello")
        XCTAssertEqual((payload["uploads"] as? [Any])?.count, 0)
        drafts.completeSend(.init(requestId: request.requestId, status: .accepted))
        XCTAssertEqual(drafts.text, "")
    }

    func testLatePickerResultsStayWithTheirOriginalChatAndDraftSurvivesNavigation() throws {
        let drafts = ComposerDrafts()
        drafts.select(first)
        drafts.text = "Inspect this"
        let loading = try XCTUnwrap(drafts.beginImport())
        drafts.select(second)
        drafts.finishImport(loading, attachments: [photo()])
        XCTAssertTrue(drafts.items.isEmpty)
        XCTAssertEqual(drafts.text, "")
        drafts.select(first)
        XCTAssertEqual(drafts.items.count, 1)
        XCTAssertEqual(drafts.text, "Inspect this")
        drafts.remove(drafts.items[0].id)
        XCTAssertTrue(drafts.items.isEmpty)
    }

    func testCancellingPhotoCaptureAfterNavigationReleasesOnlyItsOriginalDraft() throws {
        let drafts = ComposerDrafts(); drafts.select(first)
        drafts.text = "Keep this draft"
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: [photo()])
        let capture = try XCTUnwrap(drafts.beginImport())
        drafts.select(second)
        drafts.text = "Other conversation"
        drafts.finishImport(capture, attachments: [])
        XCTAssertEqual(drafts.text, "Other conversation")
        XCTAssertTrue(drafts.items.isEmpty)
        drafts.select(first)
        XCTAssertFalse(drafts.importing)
        XCTAssertFalse(drafts.sending)
        XCTAssertEqual(drafts.text, "Keep this draft")
        XCTAssertEqual(drafts.items.count, 1)
        XCTAssertNotNil(drafts.beginSend(), "Cancellation must not leave Submit blocked")
    }

    func testAttachmentOnlySendRetainsBytesUntilAcceptedAndKeepsThemWhenDeliveryIsUnknown() throws {
        let drafts = ComposerDrafts(); drafts.select(first)
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: [photo()])
        let send = try XCTUnwrap(drafts.beginSend())
        XCTAssertEqual(send.text, "")
        XCTAssertEqual(send.uploads[0].data, Data(repeating: 1, count: 10).base64EncodedString())
        XCTAssertNil(drafts.beginSend())
        drafts.completeSend(.init(requestId: send.requestId, status: .unknown))
        XCTAssertEqual(drafts.items.count, 1)
        XCTAssertNotNil(drafts.error)
        let retry = try XCTUnwrap(drafts.beginSend())
        drafts.select(second)
        drafts.text = "New draft"
        drafts.completeSend(.init(requestId: retry.requestId, status: .accepted))
        XCTAssertEqual(drafts.text, "New draft")
        drafts.select(first)
        XCTAssertTrue(drafts.items.isEmpty)
    }

    func testCountAndCombinedByteLimitsRejectBatchWithoutDroppingTheExistingDraft() throws {
        let drafts = ComposerDrafts(); drafts.select(first)
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: [photo(2_000_000)])
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: [photo(600_000)])
        XCTAssertEqual(drafts.items.count, 1)
        XCTAssertNotNil(drafts.error)
        drafts.finishImport(try XCTUnwrap(drafts.beginImport()), attachments: (0..<5).map { _ in photo() })
        XCTAssertEqual(drafts.items.count, 1)
        XCTAssertFalse(drafts.importing)
    }
}
