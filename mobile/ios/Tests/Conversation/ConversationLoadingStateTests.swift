import XCTest
@testable import CompanionConversation

final class ConversationLoadingStateTests: XCTestCase {
    func testLoadFailureIsVisibleUntilRetryAndSuccessfulRendering() {
        var state = ConversationLoadingState()
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: true, hasAgent: true)
        XCTAssertTrue(state.failed)
        XCTAssertFalse(state.isLoading)
        state.select()
        XCTAssertFalse(state.failed)
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: false, hasAgent: true)
        state.rendered()
        XCTAssertFalse(state.failed)
        XCTAssertFalse(state.isLoading)
    }
    func testCachedSelectionDoesNotShowLoadingWhileTheWebViewSwapsFrames() {
        var state = ConversationLoadingState()
        state.select()
        state.update(fetching: false, failed: false, hasAgent: true)
        XCTAssertFalse(state.isLoading)
        state.rendered()
        state.select()
        XCTAssertFalse(state.isLoading)
    }

    func testFetchedConversationStaysCoveredUntilPaintedAndFailureReleasesIt() {
        var state = ConversationLoadingState()
        state.select()
        state.update(fetching: true, failed: false, hasAgent: true)
        XCTAssertTrue(state.isLoading)
        state.update(fetching: false, failed: false, hasAgent: true)
        XCTAssertTrue(state.isLoading)
        state.rendered()
        XCTAssertFalse(state.isLoading)
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: true, hasAgent: true)
        XCTAssertFalse(state.isLoading)
    }

    func testSwitchingToCachedChatClearsAnotherChatsPendingFetch() {
        var state = ConversationLoadingState()
        state.update(fetching: true, failed: false, hasAgent: true)
        state.select()
        state.update(fetching: false, failed: false, hasAgent: true)
        XCTAssertFalse(state.isLoading)
    }
}
