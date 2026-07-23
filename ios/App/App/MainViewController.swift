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
//
// registerPluginType(_:) (tried first, confirmed NOT sufficient via live-device
// test on build 35) is a no-op whenever auto-registration is active -- its very
// first line in CapacitorBridge.swift is `if autoRegisterPlugins { return }`.
// This app's plugins ARE auto-registered (from capacitor.config.json's
// packageClassList), so that path silently did nothing. registerPluginInstance(_:)
// has no such guard and unconditionally registers whatever instance it's given,
// which is what actually works alongside the existing auto-registered plugins.
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CanopyShare())
    }
}
