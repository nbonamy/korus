import XCTest

// Regression: replacing a scrolled repository catalog with asynchronously loaded
// branches must expose tappable rows, including when changing repositories.
final class ProjectPickerUITests: XCTestCase {
    @MainActor private func openGitLab(_ app: XCUIApplication) {
        app.buttons["New Agent"].tap()
        XCTAssertTrue(app.buttons["From GitHub"].exists)
        XCTAssertTrue(app.buttons["New Project"].exists)
        XCTAssertTrue(app.buttons["Existing Project"].exists)
        XCTAssertTrue(app.buttons["From URL"].exists)
        XCTAssertTrue(app.buttons["From GitLab"].waitForExistence(timeout: 3))
        app.buttons["From GitLab"].tap()
        XCTAssertTrue(app.navigationBars["GitLab Repository"].waitForExistence(timeout: 5))
    }

    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor func testGitLabNestedRepositoryDefaultBranchAndProviderSwitching() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        openGitLab(app)
        capture("gitlab-nested-catalog")
        app.buttons["group/subgroup/korus"].tap()
        let branch = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "develop")).firstMatch
        XCTAssertTrue(branch.waitForExistence(timeout: 5))
        XCTAssertTrue(branch.label.contains("Default"))
        capture("gitlab-default-branch")
        app.buttons["Cancel"].tap()
        app.buttons["New Agent"].tap()
        app.buttons["From GitHub"].tap()
        XCTAssertTrue(app.navigationBars["GitHub Repository"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["group/subgroup/korus"].exists)
        XCTAssertFalse(branch.exists)
        let search = app.textFields["Search repositories"]
        search.tap(); search.typeText("korus")
        app.buttons["korus"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "main")).firstMatch.waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        openGitLab(app)
        XCTAssertEqual(app.textFields["Search repositories"].value as? String, "Search repositories")
        app.buttons["group/subgroup/korus"].tap()
        XCTAssertTrue(branch.waitForExistence(timeout: 5))
        branch.tap()
        XCTAssertTrue(app.staticTexts["Selected gitlab gitlab:opaque:develop base:"].waitForExistence(timeout: 5))
    }

    @MainActor func testGitLabNewWorktreeUsesItsDefaultBaseAndRetainsInputsAfterCloneFailure() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launchArguments = ["--clone-retry"]
        app.launch()
        openGitLab(app)
        app.buttons["group/subgroup/korus"].tap()
        XCTAssertTrue(app.buttons["New Branch"].waitForExistence(timeout: 5))
        app.buttons["New Branch"].tap()
        let input = app.textFields["Branch name"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Create Branch"].isEnabled == false)
        input.tap(); input.typeText("feature/ios-new")
        app.buttons["Create Branch"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Couldn’t create this branch")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "feature/ios-new")
        capture("gitlab-worktree-retry")
        app.buttons["Create Branch"].tap()
        XCTAssertTrue(app.staticTexts["Selected gitlab gitlab:opaque:feature/ios-new base:develop"].waitForExistence(timeout: 5))
    }

    @MainActor func testGitLabAccessAndBranchRecoveryAndEmptyCatalog() {
        let app = XCUIApplication()
        continueAfterFailure = false
        for scenario in ["--access-retry", "--branch-retry", "--empty"] {
            app.launchArguments = [scenario]; app.launch()
            openGitLab(app)
            if scenario == "--access-retry" {
                XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "GitLab connection")).firstMatch.waitForExistence(timeout: 5))
                capture("gitlab-access-retry")
                app.buttons["Retry"].tap()
            }
            if scenario == "--empty" {
                XCTAssertTrue(app.staticTexts["No repositories available."].waitForExistence(timeout: 5))
                capture("gitlab-empty")
            } else {
                app.buttons["group/subgroup/korus"].tap()
                if scenario == "--branch-retry" { XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 5)); app.buttons["Retry"].tap() }
                XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "develop")).firstMatch.waitForExistence(timeout: 5))
            }
            app.terminate()
        }
    }

    @MainActor func testHostSwitchDismissesTheOldSelectionAndReloadsTheNewCatalog() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launchArguments = ["--host-switch"]
        app.launch()
        openGitLab(app)
        app.buttons["group/subgroup/korus"].tap()
        XCTAssertTrue(app.buttons["New Branch"].waitForExistence(timeout: 5))
        app.buttons["Switch Host"].tap()
        XCTAssertTrue(app.buttons["New Agent"].waitForExistence(timeout: 5))
        openGitLab(app)
        XCTAssertTrue(app.buttons["remote/group/korus"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["group/subgroup/korus"].exists)
        app.buttons["remote/group/korus"].tap()
        let branch = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "develop")).firstMatch
        XCTAssertTrue(branch.waitForExistence(timeout: 5)); branch.tap()
        XCTAssertTrue(app.staticTexts["Selected gitlab gitlab:second:develop base:"].waitForExistence(timeout: 5))
    }

    @MainActor func testForgetConfirmationUsesACenteredAlertAndCancelKeepsTheLaptop() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.buttons["Forget this laptop"].tap()
        let alert = app.alerts["Forget this laptop?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertEqual(alert.frame.midX, app.frame.midX, accuracy: 8)
        XCTAssertEqual(alert.frame.midY, app.frame.midY, accuracy: 80)
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Laptop retained"].exists)
        app.buttons["Forget this laptop"].tap()
        alert.buttons["Forget Laptop"].tap()
        XCTAssertTrue(app.staticTexts["Laptop forgotten"].waitForExistence(timeout: 5))
    }

    @MainActor func testRenameValidatesTheNameAndRequiresSave() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.buttons["Rename Agent"].tap()
        let name = app.textFields["Agent name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "Original")
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "   ")
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Agent: Original"].waitForExistence(timeout: 5))
        app.buttons["Rename Agent"].tap()
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "  Mobile work  ")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Agent: Mobile work"].waitForExistence(timeout: 5))
    }

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
