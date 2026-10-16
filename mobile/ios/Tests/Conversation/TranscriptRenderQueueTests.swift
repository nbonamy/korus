import XCTest
@testable import CompanionConversation

final class TranscriptRenderQueueTests: XCTestCase {
    func testFirstMessageStartsAtOnceAndLaterOnesWaitForIt() {
        var queue = TranscriptRenderQueue()
        XCTAssertEqual(queue.enqueue(.conversation, "a"), .init(kind: .conversation, json: "a"))
        XCTAssertNil(queue.enqueue(.conversation, "b"))
        XCTAssertTrue(queue.isBusy)
    }

    func testOnlyTheNewestWaitingConversationIsDrawn() {
        var queue = TranscriptRenderQueue()
        _ = queue.enqueue(.conversation, "a")
        for next in ["b", "c", "d"] { XCTAssertNil(queue.enqueue(.conversation, next)) }
        XCTAssertEqual(queue.finish(), .init(kind: .conversation, json: "d"))
        XCTAssertNil(queue.finish())
        XCTAssertFalse(queue.isBusy)
    }

    func testAConversationAlreadyCarriesTheContextSentBeforeIt() {
        var queue = TranscriptRenderQueue()
        _ = queue.enqueue(.conversation, "a")
        XCTAssertNil(queue.enqueue(.context, "old"))
        XCTAssertNil(queue.enqueue(.conversation, "b"))
        XCTAssertEqual(queue.finish(), .init(kind: .conversation, json: "b"))
        XCTAssertNil(queue.finish())
    }

    func testAContextSentAfterAConversationStillFollowsIt() {
        var queue = TranscriptRenderQueue()
        _ = queue.enqueue(.conversation, "a")
        XCTAssertNil(queue.enqueue(.conversation, "b"))
        XCTAssertNil(queue.enqueue(.context, "c1"))
        XCTAssertNil(queue.enqueue(.context, "c2"))
        XCTAssertEqual(queue.finish(), .init(kind: .conversation, json: "b"))
        XCTAssertEqual(queue.finish(), .init(kind: .context, json: "c2"))
        XCTAssertNil(queue.finish())
    }

    func testAFreePageTakesTheNextMessageImmediatelyAgain() {
        var queue = TranscriptRenderQueue()
        _ = queue.enqueue(.context, "x")
        XCTAssertNil(queue.finish())
        XCTAssertEqual(queue.enqueue(.context, "y"), .init(kind: .context, json: "y"))
    }
}
