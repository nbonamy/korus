import XCTest

// Regression: replacing a scrolled repository catalog with asynchronously loaded
// branches must expose tappable rows, including when changing repositories.
final class ProjectPickerUITests: XCTestCase {
    @MainActor func testSearchingForRepositoriesKeepsLoadedBranchesVisibleAfterKeyboardDismissal() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.buttons["Existing Project"].tap()
        for (repository, branch) in [("mediastation", "master"), ("korus", "main")] {
            let search = app.textFields["Search repositories"]
            search.tap()
            let old = search.value as? String ?? ""
            if old != "Search repositories" { search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count)) }
            search.typeText(repository)
            app.buttons[repository].tap()
            let choice = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", branch)).firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 5), "Loaded branches must appear for \(repository)")
            XCTAssertTrue(choice.isHittable, "Loaded branches must be visible for \(repository)")
            if repository == "mediastation" { app.buttons["Repositories"].tap() }
            else { choice.tap() }
        }
        XCTAssertTrue(app.staticTexts["Selected korus-id:main"].waitForExistence(timeout: 5))
    }

    @MainActor func testScrolledRepositorySelectionShowsBranchesAndCanOpenTheDefault() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.buttons["Existing Project"].tap()
        for (repository, branch) in [("mediastation", "master"), ("korus", "main")] {
            let row = app.buttons[repository]
            for _ in 0..<12 {
                if row.exists && row.isHittable { break }
                app.scrollViews.firstMatch.swipeUp()
            }
            XCTAssertTrue(row.isHittable, "Repository must be reachable after scrolling")
            row.tap()
            let choice = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", branch)).firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 5), "Loaded branches must appear for \(repository)")
            XCTAssertTrue(choice.isHittable, "Loaded branches must be visible for \(repository)")
            if repository == "mediastation" { app.buttons["Repositories"].tap() }
            else { choice.tap() }
        }
        XCTAssertTrue(app.staticTexts["Selected korus-id:main"].waitForExistence(timeout: 5))
    }
}
