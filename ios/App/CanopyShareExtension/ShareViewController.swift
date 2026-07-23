// Canopy's WhatsApp/OS share-sheet entry point on iOS.
//
// This file belongs to the CanopyShareExtension target (created in Xcode via
// File > New > Target > Share Extension), NOT the main App target. It runs in
// its own separate process with no direct access to the running app or its JS
// runtime, so its only job is: read whatever was shared, write it into a
// shared App Group container, then hand off to the main app via the canopy://
// URL scheme. CanopySharePlugin.swift (in the main App target) picks it up
// from there -- see that file's header comment for the full round trip.
//
// Shows no UI at all -- the OS's own "opening Canopy..." transition is the
// only visible feedback, matching the instant one-tap feel of the Android
// share-target flow.
//
// DIAGNOSTIC MODE (added 2026-07-23, remove once the "share never launches
// Canopy" bug is confirmed fixed): every exit path now writes a debug string
// into the App Group under debugKey AND always calls openHostAppAndComplete()
// -- even on failure -- instead of silently completeAndExit()ing. There's no
// way to attach a live debugger to this extension without a cable + MacinCloud
// Dedicated-plan USB passthrough, which isn't set up, so this makes the
// failure visible on-device instead: the app opens, finds no pending share,
// but does find debug text and can show it. See AppLayout.jsx / canopyShare.js.
import UIKit
import UniformTypeIdentifiers

@objc
public class ShareViewController: UIViewController {

    static let appGroupId = "group.app.canopy.app.share"
    static let pendingShareKey = "canopy_pending_share"
    static let debugKey = "canopy_share_debug"

    public override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("CanopyShare: viewDidLoad called")
        storeDebug("handleShare called")
        handleShare()
    }

    private func handleShare() {
        NSLog("CanopyShare: handleShare entered")
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            NSLog("CanopyShare: no input item at all")
            appendDebug("no input item at all (inputItems.count = \(extensionContext?.inputItems.count ?? -1))")
            openHostAppAndComplete()
            return
        }

        guard let attachment = item.attachments?.first else {
            // Some apps (WhatsApp forwarded text, in particular) deliver plain
            // text via attributedContentText instead of populating attachments
            // at all -- without this fallback the extension used to exit
            // silently here, which looks like "nothing happens" from the
            // sending app's side.
            if let text = item.attributedContentText?.string,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                appendDebug("no attachments; used attributedContentText fallback, length \(text.count)")
                store(payload: ["type": "text", "text": text])
            } else {
                appendDebug("no attachments and no usable attributedContentText (attachments = \(item.attachments?.count ?? -1), attributedContentText = \(item.attributedContentText?.string ?? "nil"))")
            }
            openHostAppAndComplete()
            return
        }
        appendDebug("attachment types = \(attachment.registeredTypeIdentifiers)")

        if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            // Live-device syslog (2026-07-23, build 29 test) showed loadObject(ofClass:
            // NSString.self) reaching Foundation's own error path: "Instantiation of
            // class NSString failed" (NSCocoaErrorDomain code 4864) -- WhatsApp's shared
            // text item isn't decodable via the NSItemProviderReading class-bridging
            // loadObject relies on. The _EXSinkLoadOperator "nil expectedValueClass"
            // <Fault> seen both before and after that change turned out to be a generic
            // ExtensionFoundation compatibility-bridge log line, not the actual bug --
            // it appears regardless of which of these APIs is used.
            // loadDataRepresentation sidesteps class-bridging entirely (raw bytes, no
            // NSSecureCoding/NSItemProviderReading involved), so it works regardless of
            // how the sending app's item provider is implemented -- IN THEORY. Live
            // testing 2026-07-23 found it can still come back empty (a provider that
            // only implements the older loadItem(forTypeIdentifier:) selector-based
            // mechanism has nothing to hand back to the newer data-representation API).
            // Falls back to that older API rather than assuming which one a given
            // sending app actually supports.
            attachment.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, _ in
                if let data = data, let text = String(data: data, encoding: .utf8),
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self?.appendDebug("plainText loadDataRepresentation succeeded, length \(text.count)")
                    self?.store(payload: ["type": "text", "text": text])
                    self?.openHostAppAndComplete()
                    return
                }
                self?.appendDebug("plainText loadDataRepresentation returned empty/non-UTF8 data, trying loadItem fallback")
                attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] reading, _ in
                    let text = (reading as? String) ?? (reading as? NSString) as String?
                    guard let text = text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                        self?.appendDebug("plainText loadItem fallback also returned empty/non-String data")
                        self?.openHostAppAndComplete()
                        return
                    }
                    self?.appendDebug("plainText loadItem fallback succeeded, length \(text.count)")
                    self?.store(payload: ["type": "text", "text": text])
                    self?.openHostAppAndComplete()
                }
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] data, _ in
                self?.handleFileAttachment(data, kind: "image")
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { [weak self] data, _ in
                self?.handleFileAttachment(data, kind: "pdf")
            }
        } else {
            appendDebug("attachment present but no matching type")
            openHostAppAndComplete()
        }
    }

    // NSItemProvider can hand back either a URL (most common for files on
    // disk) or raw Data depending on the sending app -- handle both rather
    // than assuming one.
    private func handleFileAttachment(_ item: NSSecureCoding?, kind: String) {
        let bytes: Data?
        if let url = item as? URL {
            bytes = try? Data(contentsOf: url)
        } else if let data = item as? Data {
            bytes = data
        } else {
            bytes = nil
        }

        guard let fileBytes = bytes, !fileBytes.isEmpty else {
            appendDebug("\(kind) attachment loaded but bytes empty/nil")
            openHostAppAndComplete()
            return
        }

        if kind == "image" {
            // Same lesson learned the hard way on Android: don't trust the
            // OS/sending-app-reported type -- sniff the actual file bytes'
            // magic number instead, since it's authoritative regardless of
            // what any UTI metadata claims.
            let mediaType = ShareViewController.sniffImageMediaType(fileBytes) ?? "image/jpeg"
            store(payload: ["type": "image", "base64": fileBytes.base64EncodedString(), "mediaType": mediaType])
        } else {
            store(payload: ["type": "pdf", "base64": fileBytes.base64EncodedString()])
        }
        openHostAppAndComplete()
    }

    private func store(payload: [String: Any]) {
        guard let defaults = UserDefaults(suiteName: ShareViewController.appGroupId),
              let json = try? JSONSerialization.data(withJSONObject: payload) else { return }
        defaults.set(json, forKey: ShareViewController.pendingShareKey)
    }

    private func storeDebug(_ message: String) {
        UserDefaults(suiteName: ShareViewController.appGroupId)?.set(message, forKey: ShareViewController.debugKey)
    }

    private func appendDebug(_ message: String) {
        guard let defaults = UserDefaults(suiteName: ShareViewController.appGroupId) else { return }
        let existing = defaults.string(forKey: ShareViewController.debugKey) ?? ""
        defaults.set(existing.isEmpty ? message : "\(existing) | \(message)", forKey: ShareViewController.debugKey)
    }

    private func openHostAppAndComplete() {
        // NSItemProvider completion handlers (loadDataRepresentation/loadItem/
        // loadObject) are explicitly documented as NOT guaranteed to run on the
        // main thread -- this function is called from inside those completion
        // handlers, and extensionContext.open(_:) is a UIKit-adjacent API.
        // Live-device testing 2026-07-23 found `success = false` specifically
        // on the loadDataRepresentation path (background-thread completion)
        // while the synchronous attributedContentText fallback path (already on
        // the main thread) succeeded -- forcing main-thread dispatch here
        // removes that inconsistency regardless of which caller path led here.
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.openHostAppAndComplete() }
            return
        }
        NSLog("CanopyShare: openHostAppAndComplete entered")
        guard let url = URL(string: "canopy://share") else {
            NSLog("CanopyShare: failed to construct canopy://share URL")
            appendDebug("failed to construct canopy://share URL")
            completeAndExit()
            return
        }
        // extensionContext.open(_:) is the documented API for an extension to
        // ask the OS to open a URL in the host app -- UIApplication.shared
        // isn't available from an extension process at all.
        NSLog("CanopyShare: calling extensionContext.open")
        extensionContext?.open(url, completionHandler: { [weak self] success in
            NSLog("CanopyShare: extensionContext.open completion, success = \(success)")
            self?.appendDebug("extensionContext.open success = \(success)")
            self?.completeAndExit()
        })
    }

    private func completeAndExit() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    static func sniffImageMediaType(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(12))
        if b.count >= 8, b[0] == 0x89, b[1] == 0x50, b[2] == 0x4E, b[3] == 0x47,
           b[4] == 0x0D, b[5] == 0x0A, b[6] == 0x1A, b[7] == 0x0A {
            return "image/png"
        }
        if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF {
            return "image/jpeg"
        }
        if b.count >= 6, b[0] == 0x47, b[1] == 0x49, b[2] == 0x46, b[3] == 0x38,
           (b[4] == 0x37 || b[4] == 0x39), b[5] == 0x61 {
            return "image/gif"
        }
        if b.count >= 12, b[0] == 0x52, b[1] == 0x49, b[2] == 0x46, b[3] == 0x46,
           b[8] == 0x57, b[9] == 0x45, b[10] == 0x42, b[11] == 0x50 {
            return "image/webp"
        }
        return nil
    }
}
