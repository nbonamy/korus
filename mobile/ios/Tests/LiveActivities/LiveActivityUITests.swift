import XCTest

// Real ActivityKit + production observer: duplicate starts, laptop switches and
// opt-out must not leave multiple or foreign activities on the Lock Screen.
final class LiveActivityUITests: XCTestCase {
    @MainActor func testSingleActivityAndNativeOptOut() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        let count = app.staticTexts["activity-count"]
        XCTAssertTrue(count.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["mobile"].exists)
        XCTAssertTrue(app.staticTexts["main"].exists)
        XCTAssertTrue(app.staticTexts["Nicolas-MacBook-Pro.local"].exists)
        XCTAssertTrue(app.staticTexts["1 task"].exists)
        XCTAssertFalse(app.staticTexts["Working"].exists)
        XCTAssertFalse(app.staticTexts["Completing Live Activity delivery"].exists)
        XCTAssertEqual(app.images.matching(identifier: "Codex agent icon").count, 0)
        app.buttons["Start duplicate activities"].tap()
        XCTAssertTrue(count.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 1"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        capture("live-activity-lock-screen-layout")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(XCUIApplication(bundleIdentifier: "com.apple.springboard").wait(for: .runningForeground, timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.005)).press(forDuration: 0.1,
            thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
        Thread.sleep(forTimeInterval: 1)
        let title = springboard.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Debugging screenshot visibility")).firstMatch
        // A fresh simulator discovers and launches widget extensions after installation.
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        XCTAssertTrue(title.isHittable)
        if springboard.buttons["Allow"].exists { springboard.buttons["Allow"].tap() }
        XCTAssertTrue(springboard.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "mobile")).firstMatch.isHittable)
        XCTAssertFalse(springboard.staticTexts["Completing Live Activity delivery"].exists)
        Thread.sleep(forTimeInterval: 0.5)
        capture("live-activity-notification-center")
        let mainLink = springboard.descendants(matching: .any).matching(identifier: "activity-thread-main").firstMatch
        XCTAssertTrue(mainLink.waitForExistence(timeout: 5))
        mainLink.tap()
        XCTAssertTrue(app.staticTexts["Opened: main"].waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)

        Thread.sleep(forTimeInterval: 1)
        capture("live-activity-dynamic-island")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.055)).press(forDuration: 1)
        XCTAssertTrue(springboard.staticTexts["Nicolas-MacBook-Pro.local"].waitForExistence(timeout: 5))
        capture("live-activity-expanded-island")
        app.activate()
        Thread.sleep(forTimeInterval: 1)
        app.buttons["Renew activity"].tap()
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 1"), evaluatedWith: count)
        expectation(for: NSPredicate(format: "label == %@", "Active running: 5"), evaluatedWith: app.staticTexts["active-running"])
        waitForExpectations(timeout: 8)
        XCTAssertTrue(app.staticTexts["Approval required"].exists)
        capture("live-activity-approval-layout")
        app.buttons["Switch laptop"].tap()
        XCTAssertEqual(app.staticTexts["selected-host"].label, "Selected: second-host")
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 0"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        app.buttons["Start duplicate activities"].tap()
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 1"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        app.switches["Live Activities"].coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertEqual(app.switches["Live Activities"].value as? String, "0")
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 0"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        app.buttons["Start duplicate activities"].tap()
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 1"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        app.buttons["Forget laptop"].tap()
        XCTAssertEqual(app.staticTexts["selected-host"].label, "Selected: none")
        expectation(for: NSPredicate(format: "label == %@", "Active activities: 0"), evaluatedWith: count)
        waitForExpectations(timeout: 8)
        app.terminate()
        app.launchArguments = ["--crowded"]
        app.launch()
        XCTAssertTrue(app.staticTexts["3 tasks"].waitForExistence(timeout: 8))
        app.buttons["Start duplicate activities"].tap()
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.005)).press(forDuration: 0.1,
            thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
        XCTAssertTrue(springboard.staticTexts["3 tasks"].waitForExistence(timeout: 30))
        XCTAssertFalse(springboard.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "+1 more task")).firstMatch.exists)
        capture("live-activity-three-tasks")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        capture("live-activity-compact-count")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.055)).press(forDuration: 1)
        let secondDetail = springboard.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Refining Live Activity rows")).firstMatch
        XCTAssertTrue(secondDetail.waitForExistence(timeout: 5))
        XCTAssertTrue(secondDetail.isHittable)
        capture("live-activity-expanded-two-working")
        app.activate()
        app.buttons["Check upgrade recovery"].tap()
        XCTAssertTrue(app.staticTexts["Upgrade recovery: active=0 missing=1 restart=1"].waitForExistence(timeout: 8))
        capture("live-activity-upgrade-recovery")
    }
    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
