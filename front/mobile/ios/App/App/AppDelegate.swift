import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Before the web view exists, so its first write already lands in an excluded folder.
        excludeWebDataFromBackup()
        // Initialize iCloud container
        initializeICloudContainer()
        return true
    }

    /// Keeps the web view storage out of iCloud and computer backups. It holds the sync chain
    /// keys and proof (IndexedDB lector-chaine) and the personal API keys (lector-keys): they must
    /// never leave the phone. A new iPhone joins the chain with its 12 words.
    /// WKWebView keeps IndexedDB and localStorage under Library/WebKit; excluding the folder
    /// excludes everything in it, including what WebKit creates later. Re-applied on every
    /// activation in case the folder was recreated (restore, WebKit migration).
    private func excludeWebDataFromBackup() {
        let fileManager = FileManager.default
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        for name in ["WebKit", "Cookies"] {
            var url = library.appendingPathComponent(name, isDirectory: true)
            do {
                try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try url.setResourceValues(values)
            } catch {
                NSLog("Lector: could not exclude Library/%@ from backup: %@", name, error.localizedDescription)
            }
        }
    }

    private func initializeICloudContainer() {
        // This triggers iCloud container creation
        DispatchQueue.global(qos: .background).async {
            if let containerURL = FileManager.default.url(forUbiquityContainerIdentifier: "iCloud.com.lector.app") {
                let documentsURL = containerURL.appendingPathComponent("Documents")

                // Create Documents folder if needed
                if !FileManager.default.fileExists(atPath: documentsURL.path) {
                    try? FileManager.default.createDirectory(at: documentsURL, withIntermediateDirectories: true)
                }

                // Create a welcome file to make folder visible
                let welcomeFile = documentsURL.appendingPathComponent("Bienvenue.md")
                if !FileManager.default.fileExists(atPath: welcomeFile.path) {
                    let content = """
                    # Bienvenue dans Lector 📖

                    Ce dossier est synchronisé avec iCloud.

                    Placez vos fichiers Markdown (.md) ici pour les lire sur tous vos appareils.

                    ## Fonctionnalités
                    - 📱 Sync iPhone / Mac
                    - 🧠 Mind Maps automatiques
                    - 🎴 Flashcards intégrées
                    - ☁️ Backup iCloud
                    """
                    try? content.write(to: welcomeFile, atomically: true, encoding: .utf8)
                }

                print("✅ iCloud container initialized at: \\(containerURL.path)")
            } else {
                print("❌ iCloud not available")
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        excludeWebDataFromBackup()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
