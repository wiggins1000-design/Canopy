// Bridges iOS's OS share sheet (e.g. "Share" from WhatsApp) into JS, mirroring
// android/.../CanopySharePlugin.java's JS-facing contract exactly (getPendingShares/
// clearPendingShares/shareReceived). Vendored directly into the App target rather
// than added via CapApp-SPM/Package.swift, following the same pattern as
// SpeechRecognitionPlugin.swift (see that file's header comment) -- a local,
// unpublished plugin has no npm/SPM packaging for Capacitor's auto-wrapper to
// find, so it must be compiled directly into the app's own target instead.
//
// The actual share content is written into a shared App Group container's
// queue by the CanopyShareExtension target (ShareViewController.swift), since
// an extension runs in its own separate process with no direct access to the
// main app or its JS runtime. AppDelegate.swift's application(_:open:)
// forwards the canopy:// URL scheme open (the extension's handoff signal)
// into handleShareURLOpen() below.
//
// This plugin is never picked up by Capacitor's normal auto-registration --
// see MainViewController.swift's header comment for why, and why it's
// registered manually via registerPluginInstance() instead.
import Foundation
import Capacitor

@objc(CanopyShare)
public class CanopyShare: CAPPlugin {

    static let appGroupId = "group.app.canopy.app.share"
    static let pendingShareKey = "canopy_pending_share"
    static var instance: CanopyShare?

    public override func load() {
        CanopyShare.instance = self
    }

    @objc func getPendingShares(_ call: CAPPluginCall) {
        call.resolve(["shares": CanopyShare.readPendingShares()])
    }

    @objc func clearPendingShares(_ call: CAPPluginCall) {
        CanopyShare.clearStoredShares()
        call.resolve()
    }

    // Called from AppDelegate when the app opens via the canopy:// URL scheme.
    static func handleShareURLOpen() {
        let shares = readPendingShares()
        guard !shares.isEmpty else { return }
        instance?.notifyListeners("shareReceived", data: ["shares": shares])
    }

    private static func readPendingShares() -> [[String: Any]] {
        guard let defaults = UserDefaults(suiteName: appGroupId),
              let data = defaults.data(forKey: pendingShareKey),
              let shares = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
            return []
        }
        return shares
    }

    private static func clearStoredShares() {
        UserDefaults(suiteName: appGroupId)?.removeObject(forKey: pendingShareKey)
    }
}
