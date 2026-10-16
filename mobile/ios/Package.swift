// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CompanionDictation",
    platforms: [.macOS(.v14), .iOS("26.0")],
    targets: [
        .target(name: "CompanionDiagnostics", path: "Sources/Diagnostics"),
        .testTarget(name: "CompanionDiagnosticsTests", dependencies: ["CompanionDiagnostics"], path: "Tests/Diagnostics"),
        .target(name: "CompanionUsage", path: "Sources/Usage"),
        .testTarget(name: "CompanionUsageTests", dependencies: ["CompanionUsage"], path: "Tests/Usage"),
        .target(name: "CompanionLock", path: "Sources/Lock"),
        .testTarget(name: "CompanionLockTests", dependencies: ["CompanionLock"], path: "Tests/Lock"),
        .target(name: "CompanionNotifications", path: "Sources/Notifications"),
        .testTarget(name: "CompanionNotificationsTests", dependencies: ["CompanionNotifications"], path: "Tests/Notifications"),
        .target(name: "CompanionPairing", path: "Sources/Pairing"),
        .testTarget(name: "CompanionPairingTests", dependencies: ["CompanionPairing"], path: "Tests/Pairing"),
        .target(name: "CompanionComposer", path: "Sources/Composer"),
        .testTarget(name: "CompanionComposerTests", dependencies: ["CompanionComposer"], path: "Tests/Composer"),
        .target(name: "CompanionSidebar", path: "Sources/Model", exclude: ["AppModel.swift", "Fixtures.swift"], sources: ["ViewModels.swift", "ConnectionNoticeState.swift", "SidebarOrganization.swift"]),
        .testTarget(name: "CompanionSidebarTests", dependencies: ["CompanionSidebar"], path: "Tests/Sidebar"),
        .target(name: "CompanionRequests", path: "Sources/Requests"),
        .testTarget(name: "CompanionRequestsTests", dependencies: ["CompanionRequests"], path: "Tests/Requests"),
        .target(name: "CompanionConversation", path: "Sources/Conversation"),
        .testTarget(name: "CompanionConversationTests", dependencies: ["CompanionConversation"], path: "Tests/Conversation"),
        .target(name: "CompanionDictation", path: "Sources/Dictation"),
        .testTarget(name: "CompanionDictationTests", dependencies: ["CompanionDictation"], path: "Tests/Dictation")
    ]
)
