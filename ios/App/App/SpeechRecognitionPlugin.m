// Vendored from @capacitor-community/speech-recognition@7.0.1 (ios/Plugin/Plugin.m).
// See SpeechRecognitionPlugin.swift for why this is vendored directly into the App target
// instead of pulled in as an npm/SPM dependency.
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Define the plugin using the CAP_PLUGIN Macro, and
// each method the plugin supports using the CAP_PLUGIN_METHOD macro.
CAP_PLUGIN(SpeechRecognition, "SpeechRecognition",
        CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(getSupportedLanguages, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(isListening, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(checkPermissions, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
)
