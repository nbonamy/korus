import XCTest
@testable import CompanionDictation

@MainActor
final class DictationControllerTests: XCTestCase {
    func testPausesKeepCompletedUtterancesWhileLaterWordsAreRevised() async {
        let capture = Capture()
        let controller = DictationController(capture: capture)
        var draft = "My notes:"
        await controller.start(text: draft) { draft = $0 }
        capture.result?(DictationResult(text: "First thought"))
        capture.result?(DictationResult(text: "First thought.", finalizedUtteranceStart: 0))
        // On-device recognition starts a fresh partial result after silence.
        capture.result?(DictationResult(text: ""))
        XCTAssertEqual(draft, "My notes: First thought.")
        capture.result?(DictationResult(text: "Another"))
        capture.result?(DictationResult(text: "Another thought"))
        XCTAssertEqual(draft, "My notes: First thought. Another thought")
        capture.result?(DictationResult(text: "Another thought.", finalizedUtteranceStart: 8))
        // A repeated final result revises that utterance; repeated speech is retained.
        capture.result?(DictationResult(text: "Another thought!", finalizedUtteranceStart: 8))
        capture.result?(DictationResult(text: "Another thought!", finalizedUtteranceStart: 16))
        XCTAssertEqual(draft, "My notes: First thought. Another thought! Another thought!")
        XCTAssertEqual(controller.phase, .recording)
        controller.finish()
        capture.result?(DictationResult(text: "First thought. Another thought! Another thought!", finalizedUtteranceStart: 0))
        capture.completion?(nil)
        XCTAssertEqual(draft, "My notes: First thought. Another thought! Another thought!")
        XCTAssertFalse(controller.active)
    }

    func testRecognitionCanRestartAfterSilenceWithoutLosingWordsOrAcceptingOldCallbacks() async {
        let capture = Capture()
        let controller = DictationController(capture: capture)
        var draft = ""
        await controller.start(text: draft) { draft = $0 }
        capture.update?("First thought.")
        let previousUpdate = capture.update
        let previousCompletion = capture.completion
        capture.completion?(nil)
        XCTAssertEqual(controller.phase, .recording)
        XCTAssertEqual(capture.starts, 2)
        capture.update?("After thinking.")
        previousUpdate?("Late first result")
        previousCompletion?(Failure.unavailable)
        XCTAssertEqual(draft, "First thought. After thinking.")
        XCTAssertEqual(controller.phase, .recording)
        XCTAssertNil(controller.error)
        controller.finish()
        capture.completion?(nil)
        XCTAssertEqual(capture.starts, 2)
        XCTAssertFalse(controller.active)
    }

    func testRecognitionRevisesOnlyTheDictatedSuffixAndRetainsFinalWords() async {
        let capture = Capture()
        let controller = DictationController(capture: capture)
        var draft = "Existing draft"
        await controller.start(text: draft) { draft = $0 }
        XCTAssertEqual(controller.phase, .recording)
        capture.update?("hello")
        capture.update?("hello world")
        XCTAssertEqual(draft, "Existing draft hello world")
        controller.finish()
        XCTAssertTrue(capture.finished)
        XCTAssertEqual(controller.phase, .finishing)
        capture.update?("Hello world.")
        capture.completion?(nil)
        XCTAssertEqual(draft, "Existing draft Hello world.")
        XCTAssertFalse(controller.active)
        XCTAssertTrue(capture.cancelled)
    }

    func testSendOrNavigationFreezesDraftAndIgnoresPreviousSessionCallbacks() async {
        let capture = Capture()
        let controller = DictationController(capture: capture)
        var draft = ""
        await controller.start(text: draft) { draft = $0 }
        capture.update?("First prompt")
        let previousUpdate = capture.update
        let previousCompletion = capture.completion
        controller.cancel()
        draft = "Next prompt"
        await controller.start(text: draft) { draft = $0 }
        previousUpdate?("Late result")
        previousCompletion?(Failure.denied)
        XCTAssertEqual(draft, "Next prompt")
        XCTAssertEqual(controller.phase, .recording)
        XCTAssertNil(controller.error)
        capture.update?("new words")
        XCTAssertEqual(draft, "Next prompt new words")
        controller.cancel()
    }

    func testDeniedPermissionAndCaptureFailureLeaveDraftIntactAndShowAnError() async {
        for authorization in [true, false] {
            let capture = Capture()
            if authorization { capture.authorizationError = Failure.denied }
            else { capture.startError = Failure.unavailable }
            let controller = DictationController(capture: capture)
            var draft = "Keep this"
            await controller.start(text: draft) { draft = $0 }
            XCTAssertEqual(draft, "Keep this")
            XCTAssertFalse(controller.active)
            XCTAssertNotNil(controller.error)
            XCTAssertTrue(capture.cancelled)
            XCTAssertEqual(capture.starts, authorization ? 0 : 1)
        }
    }

    func testCancelledPermissionCannotStartOrCancelANewerRecording() async {
        for denied in [false, true] {
            let capture = Capture()
            capture.waitForPermission = true
            let controller = DictationController(capture: capture)
            let start = Task { await controller.start(text: "") { _ in XCTFail("Unexpected transcription") } }
            while capture.permission == nil { await Task.yield() }
            XCTAssertEqual(controller.phase, .requesting)
            controller.cancel()
            XCTAssertEqual(capture.starts, 0)
            XCTAssertFalse(controller.active)
            capture.waitForPermission = false
            var draft = "New draft"
            await controller.start(text: draft) { draft = $0 }
            if denied { capture.authorizationError = Failure.denied }
            capture.permission?.resume()
            await start.value
            capture.update?("new words")
            XCTAssertEqual(capture.starts, 1)
            XCTAssertEqual(controller.phase, .recording)
            XCTAssertEqual(draft, "New draft new words")
            XCTAssertNil(controller.error)
            controller.cancel()
        }
    }

    func testRecognitionErrorStopsCaptureAndKeepsThePartialDraft() async {
        let capture = Capture()
        let controller = DictationController(capture: capture)
        var draft = ""
        await controller.start(text: draft) { draft = $0 }
        capture.update?("Partial words")
        capture.completion?(Failure.unavailable)
        XCTAssertEqual(draft, "Partial words")
        XCTAssertFalse(controller.active)
        XCTAssertTrue(capture.cancelled)
        XCTAssertNotNil(controller.error)
    }
}

private enum Failure: Error { case denied, unavailable }

@MainActor
private final class Capture: DictationCapture {
    var result: (@MainActor (DictationResult) -> Void)?
    var update: (@MainActor (String) -> Void)? { result.map { result in { result(DictationResult(text: $0)) } } }
    var completion: (@MainActor (Error?) -> Void)?
    var authorizationError: Error?
    var startError: Error?
    var starts = 0
    var finished = false
    var cancelled = false
    var waitForPermission = false
    var permission: CheckedContinuation<Void, Never>?
    func authorize() async throws {
        if waitForPermission { await withCheckedContinuation { permission = $0 } }
        if let authorizationError { throw authorizationError }
    }
    func start(update: @escaping @MainActor (DictationResult) -> Void, completion: @escaping @MainActor (Error?) -> Void) throws {
        starts += 1
        if let startError { throw startError }
        self.result = update
        self.completion = completion
    }
    func finish() { finished = true }
    func cancel() { cancelled = true }
}
