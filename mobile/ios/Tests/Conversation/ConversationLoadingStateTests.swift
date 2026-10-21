import XCTest
@testable import CompanionConversation

final class ConversationLoadingStateTests: XCTestCase {
    func testCachedPaintStaysReadableAndUpdatingUntilTheRefreshedContentPaints() {
        var state = ConversationLoadingState()
        state.select()
        state.update(fetching: false, failed: false, hasAgent: true, refreshing: true)
        state.rendered(synchronized: false)
        XCTAssertTrue(state.hasTranscript)
        XCTAssertFalse(state.isLoading)
        XCTAssertTrue(state.isRefreshing)
        state.update(fetching: false, failed: false, hasAgent: true, refreshing: false)
        XCTAssertTrue(state.isRefreshing)
        state.rendered()
        XCTAssertFalse(state.isRefreshing)
        state.update(fetching: false, failed: true, hasAgent: true)
        XCTAssertTrue(state.hasTranscript)
        XCTAssertTrue(state.failed)
    }

    func testDisconnectReleasesAnUnpaintedFetchInsteadOfLeavingASpinner() {
        var state = ConversationLoadingState()
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: false, hasAgent: true, connected: false)
        XCTAssertFalse(state.isLoading)
        XCTAssertFalse(state.failed)
        state.update(fetching: false, failed: false, hasAgent: true, connected: false)
        XCTAssertFalse(state.isLoading)
        state.update(fetching: true, failed: false, hasAgent: true)
        XCTAssertTrue(state.isLoading)
    }

    func testRetainedTranscriptStaysVisibleWhileRefreshingAndRecoversAfterDisconnect() {
        var state = ConversationLoadingState()
        state.rendered()
        state.update(fetching: true, failed: false, hasAgent: true)
        XCTAssertFalse(state.isLoading)
        state.update(fetching: false, failed: false, hasAgent: true, connected: false)
        XCTAssertFalse(state.isLoading)
        XCTAssertFalse(state.failed)
        state.update(fetching: true, failed: false, hasAgent: true)
        XCTAssertFalse(state.isLoading)
        state.rendered()
        XCTAssertFalse(state.isLoading)
        state.select()
        state.update(fetching: true, failed: false, hasAgent: true)
        XCTAssertTrue(state.isLoading)
    }

    func testCachedRetryWaitsForRenderingEvenWithoutANetworkFetch() {
        var state = ConversationLoadingState()
        state.renderingFailed()
        state.select(awaitingRender: true)
        state.update(fetching: false, failed: false, hasAgent: true)
        XCTAssertTrue(state.isLoading)
        XCTAssertFalse(state.failed)
        state.rendered()
        XCTAssertFalse(state.isLoading)
    }

    func testRenderingFailureReleasesLoadingAndSurvivesUnrelatedEngineUpdatesUntilRetry() {
        var state = ConversationLoadingState()
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: false, hasAgent: true)
        state.renderingFailed()
        XCTAssertFalse(state.isLoading)
        XCTAssertTrue(state.failed)
        state.update(fetching: false, failed: false, hasAgent: true)
        XCTAssertTrue(state.failed)
        XCTAssertFalse(state.isLoading)
        state.select()
        state.update(fetching: true, failed: false, hasAgent: true)
        state.update(fetching: false, failed: false, hasAgent: true)
        state.rendered()
        XCTAssertFalse(state.failed)
        XCTAssertFalse(state.isLoading)
    }

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
