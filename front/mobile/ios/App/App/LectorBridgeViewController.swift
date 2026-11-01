import UIKit
import Capacitor

class LectorBridgeViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ICloudPlugin())
        bridge?.registerPluginInstance(OTAUpdatePlugin())
        bridge?.registerPluginInstance(FilePickerPlugin())
        print("Registered ICloudPlugin + OTAUpdatePlugin + FilePickerPlugin with bridge")
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        // Edge swipe back gesture (like Discord/Safari)
        navigationController?.interactivePopGestureRecognizer?.isEnabled = true

        if let webView = self.webView {
            // Disable pinch-to-zoom
            webView.scrollView.minimumZoomScale = 1.0
            webView.scrollView.maximumZoomScale = 1.0
            webView.scrollView.isMultipleTouchEnabled = false

            // Disable WebView scroll bounce: the inner divs handle their own scroll
            webView.scrollView.bounces = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.alwaysBounceHorizontal = false

            // Transparent background for safe area blending
            webView.isOpaque = false
            webView.backgroundColor = UIColor(red: 250/255, green: 249/255, blue: 247/255, alpha: 1)
            webView.scrollView.backgroundColor = .clear

            // Disable content inset adjustments: safe areas are handled in CSS
            webView.scrollView.contentInsetAdjustmentBehavior = .never
        }
    }

    // Light status bar content on dark backgrounds, dark on light
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }
}
