import XCTest

#if os(iOS)
// Real sheet controls must distinguish closing a question from dismissing or answering it.
final class RequestSheetUITests: XCTestCase {
    @MainActor func testHeaderActionsCloseWithoutRespondingAndSwitchBetweenSkipAndSave() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.buttons["Question"].tap()
        let close = app.navigationBars.buttons["Close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars.buttons["Skip"].exists)
        XCTAssertFalse(app.buttons["Send Answer"].exists)
        XCTAssertFalse(app.buttons["Skip Question"].exists)
        close.tap()
        XCTAssertTrue(app.staticTexts["Responses: 0, last: none"].waitForExistence(timeout: 3))
        app.buttons["Question"].tap()
        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 3))
        input.tap(); input.typeText("Custom answer")
        let submit = app.navigationBars.buttons["Save"]
        XCTAssertTrue(submit.waitForExistence(timeout: 3))
        XCTAssertTrue(submit.isEnabled)
        XCTAssertFalse(app.navigationBars.buttons["Skip"].exists)
        capture("question-header-submit")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Custom answer".count))
        let dismiss = app.navigationBars.buttons["Skip"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 3))
        capture("question-header-skip")
        dismiss.tap()
        XCTAssertTrue(app.staticTexts["Responses: 1, last: cancelled"].waitForExistence(timeout: 3))
        app.buttons["Question"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "First approach")).firstMatch.tap()
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Responses: 2, last: answered"].waitForExistence(timeout: 3))
    }

    @MainActor func testPagesRetainAnswersAndRequireExplicitNextAfterChoosingAnAnswer() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launchArguments = ["--question-multi"]
        app.launch()
        app.buttons["Question"].tap()
        XCTAssertTrue(app.navigationBars.buttons["Next"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["Anything else?"].exists)
        let first = app.textFields.firstMatch
        first.tap(); first.typeText("Typed answer")
        XCTAssertTrue(app.navigationBars.buttons["Next"].exists)
        app.navigationBars.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Anything else?"].waitForExistence(timeout: 3))
        app.navigationBars.buttons["Back"].tap()
        XCTAssertEqual(app.textFields.firstMatch.value as? String, "Typed answer")
        let option = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "First approach")).firstMatch
        option.tap()
        XCTAssertTrue(option.isSelected)
        XCTAssertTrue(app.staticTexts["Which approach?"].exists)
        XCTAssertFalse(app.staticTexts["Anything else?"].exists)
        app.navigationBars.buttons["Next"].tap()
        XCTAssertTrue(app.staticTexts["Anything else?"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["Which approach?"].exists)
        capture("question-second-page")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Responses: 1, last: answered"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["first=One;second="].exists)
    }

    @MainActor func testSkipIsDisabledOfflineButCloseStillLeavesTheQuestionPending() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launchArguments = ["--question-offline"]
        app.launch()
        app.buttons["Question"].tap()
        let skip = app.navigationBars.buttons["Skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 3))
        XCTAssertFalse(skip.isEnabled)
        app.navigationBars.buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["Responses: 0, last: none"].waitForExistence(timeout: 3))
    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
