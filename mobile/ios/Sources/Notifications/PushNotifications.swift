#if canImport(UIKit)
import UIKit
import UserNotifications
import Observation

/// OS adapter: foreground pushes enter the same banner inbox as live relay events.
@Observable
@MainActor
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotifications()
    var onNotification: ((ChatNotification, Bool) -> Void)?
    var onRegistration: (([String: String]?) -> Void)?
    private let reads = NotificationReadState()
    private var pending: [(ChatNotification, Bool)] = []
    var status = "Notifications"
    var error: String?
    private var token: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { await refresh() }
        return true
    }
    func refresh() async {
        await removeReadNotifications()
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            status = "Notification settings"
            UIApplication.shared.registerForRemoteNotifications()
            if let token { register(token) }
        case .denied:
            status = "Notifications are off"
            onRegistration?(nil)
        default: status = "Enable notifications"
        }
    }
    func enable() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        if settings.authorizationStatus != .notDetermined {
            if let url = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(url) }
            return
        }
        do { _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]); await refresh() }
        catch { self.error = "Couldn’t enable notifications. Try again in Settings." }
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let value = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = value; error = nil; register(value)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        self.error = "Push notifications couldn’t connect. In-app alerts are still available."
    }
    private func register(_ token: String) {
        let environment = Bundle.main.object(forInfoDictionaryKey: "CompanionPushEnvironment") as? String ?? "development"
        onRegistration?(["token": token, "environment": environment])
    }
    func flush() { let waiting = pending; pending.removeAll(); for (notification, tapped) in waiting { onNotification?(notification, tapped) } }
    private func receive(_ userInfo: [AnyHashable: Any], tapped: Bool) {
        guard let value = userInfo["notification"], let data = try? JSONSerialization.data(withJSONObject: value),
              let notification = try? JSONDecoder().decode(ChatNotification.self, from: data) else { return }
        if notification.kind == .read { reads.apply(notification); Task { await removeReadNotifications() } }
        else if reads.contains(notification) { Task { await removeReadNotifications() }; return }
        if let onNotification { onNotification(notification, tapped) }
        else { pending.append((notification, tapped)); if pending.count > 16 { pending.removeFirst() } }
    }
    func clear(_ notification: ChatNotification) {
        reads.apply(notification)
        Task { await removeReadNotifications() }
    }
    private func removeReadNotifications() async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let ids = delivered.compactMap { entry -> String? in
            guard let value = entry.request.content.userInfo["notification"], let data = try? JSONSerialization.data(withJSONObject: value),
                  let notification = try? JSONDecoder().decode(ChatNotification.self, from: data), reads.contains(notification) else { return nil }
            return entry.request.identifier
        }
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }
    func background(_ userInfo: [AnyHashable: Any]) async {
        receive(userInfo, tapped: false)
        await removeReadNotifications()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let userInfo = notification.request.content.userInfo
        Task { @MainActor in self.receive(userInfo, tapped: false); completionHandler([]) }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        Task { @MainActor in
            if response.actionIdentifier == UNNotificationDefaultActionIdentifier { self.receive(userInfo, tapped: true) }
            completionHandler()
        }
    }
}
@MainActor
final class CompanionAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushNotifications.shared.application(application, didFinishLaunchingWithOptions: options)
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        PushNotifications.shared.application(application, didRegisterForRemoteNotificationsWithDeviceToken: token)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushNotifications.shared.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task { await PushNotifications.shared.background(userInfo); completionHandler(.newData) }
    }

}
#endif
