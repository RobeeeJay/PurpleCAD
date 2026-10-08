import UIKit

// iPadOS 27 traps an app that hasn't adopted the scene lifecycle
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption, SIGTRAP at
// launch); the iOS 26 simulator does not, so only a device shows it.  The
// window therefore belongs to SceneDelegate, not to the app delegate.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = WebViewController()
    window.makeKeyAndVisible()
    self.window = window
  }
}
