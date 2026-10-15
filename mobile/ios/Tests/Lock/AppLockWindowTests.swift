#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import CompanionLock

@MainActor
final class AppLockWindowTests: XCTestCase {
    func testProtectionCoversAnAlreadyPresentedModalAndReleasesItAfterUnlock() async {
        let bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
        let app = UIWindow(frame: bounds)
        let root = UIViewController()
        app.rootViewController = root
        app.makeKeyAndVisible()
        let modal = UIHostingController(rootView: Text("Private conversation image"))
        modal.modalPresentationStyle = .fullScreen
        root.present(modal, animated: false)
        await Task.yield()
        let cover = AppLockWindow(frame: bounds)
        cover.windowScene = app.windowScene
        defer { cover.cover(with: nil); root.dismiss(animated: false); app.isHidden = true }
        let locked = UIHostingController(rootView: Color.white.ignoresSafeArea().overlay(Text("Unlock")))
        cover.cover(with: locked)
        XCTAssertTrue(root.presentedViewController === modal)
        XCTAssertGreaterThan(cover.windowLevel, app.windowLevel)
        XCTAssertFalse(cover.isHidden)
        XCTAssertTrue(cover.rootViewController === locked)
        XCTAssertTrue(cover.hitTest(CGPoint(x: 100, y: 100), with: nil)?.window === cover)
        XCTAssertTrue(cover.accessibilityViewIsModal)
        cover.cover(with: nil)
        XCTAssertTrue(cover.isHidden)
        XCTAssertNil(cover.rootViewController)
        XCTAssertTrue(root.presentedViewController === modal)
    }
}
#endif
