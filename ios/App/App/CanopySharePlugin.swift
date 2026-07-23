// Bridges iOS's OS share sheet (e.g. "Share" from WhatsApp) into JS, mirroring
// android/.../CanopySharePlugin.java's JS-facing contract exactly (getPendingShare/
// clearPendingShare/shareReceived). Vendored directly into the App target rather
// than added via CapApp-SPM/Package.swift, following the same pattern as
// SpeechRecognitionPlugin.swift (see that file's header comment) -- a local,
// unpublished plugin has no npm/SPM packaging for Capacitor's auto-wrapper to
// find, so it must be compiled directly into the app's own target instead.
//
// The actual share content is written into a shared App Group container by
// the CanopyShareExtension target (ShareViewController.swift), since an
// extension runs in its own separate process with no direct access to the
// main app or its JS runtime. AppDelegate.swift's application(_:open:)
// forwards the canopy:// URL scheme open (the extension's handoff signal)
// into handleShareURLOpen() below.
import Foundation
import Capacitor

@objc(CanopyShare)
public class CanopyShare: CAPPlugin {

    static let appGroupId = "group.app.canopy.app.share"
    static let pendingShareKey = "canopy_pending_share"
    // DIAGNOSTIC MODE (2026-07-23, remove once the "share never launches
    // Canopy" bug is confirmed fixed) -- see ShareViewController.swift's
    // header comment for why this exists instead of live Xcode debugging.
    static let debugKey = "canopy_share_debug"
    static var instance: CanopyShare?

    public override func load() {
        CanopyShare.instance = self
    }

    @objc func getPendingShare(_ call: CAPPluginCall) {
        call.resolve(["share": CanopyShare.readPendingShare() ?? NSNull()])
    }

    @objc func clearPendingShare(_ call: CAPPluginCall) {
        CanopyShare.clearStoredShare()
        call.resolve()
    }

    @objc func getShareDebug(_ call: CAPPluginCall) {
        let defaults = UserDefaults(suiteName: CanopyShare.appGroupId)
        let debug = defaults?.string(forKey: CanopyShare.debugKey)
        defaults?.removeObject(forKey: CanopyShare.debugKey)
        call.resolve(["debug": debug ?? NSNull()])
    }

    // Called from AppDelegate when the app opens via the canopy:// URL scheme.
    static func handleShareURLOpen() {
        guard let share = readPendingShare() else { return }
        instance?.notifyListeners("shareReceived", data: share)
    }

    private static func readPendingShare() -> [String: Any]? {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return nil }
        guard let data = defaults.data(forKey: pendingShareKey) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func clearStoredShare() {
        UserDefaults(suiteName: appGroupId)?.removeObject(forKey: pendingShareKey)
    }
}
