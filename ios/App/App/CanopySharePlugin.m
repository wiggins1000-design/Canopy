// Companion Objective-C bridging file for CanopySharePlugin.swift -- see
// SpeechRecognitionPlugin.m for the identical established pattern.
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CanopyShare, "CanopyShare",
        CAP_PLUGIN_METHOD(getPendingShare, CAPPluginReturnPromise);
        CAP_PLUGIN_METHOD(clearPendingShare, CAPPluginReturnPromise);
)
