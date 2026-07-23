// CanopyShare has no corresponding npm package, so `npx cap sync ios` can never
// find its source to add "CanopyShare" to capacitor.config.json's packageClassList
// (that list is fully regenerated on every sync by scanning npm-installed plugins'
// @objc(...)/CAP_PLUGIN(...) source -- see node_modules/@capacitor/cli/dist/util/
// iosplugin.js). Confirmed via live-device testing 2026-07-23: every call to
// CanopyShare threw "plugin is not implemented on ios" on every single launch,
// share or not -- the CAP_PLUGIN macro alone no longer auto-registers a plugin at
// runtime in Capacitor 8, it only matters for that JSON generation step.
// capacitorDidLoad() is Capacitor's documented override point for registering a
// plugin directly in code, bypassing the JSON list entirely -- durable across
// every future `cap sync ios` run, unlike hand-editing the generated JSON.
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginType(CanopyShare.self)
    }
}
