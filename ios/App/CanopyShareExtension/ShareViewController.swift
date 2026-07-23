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
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    static let appGroupId = "group.app.canopy.app.share"
    static let pendingShareKey = "canopy_pending_share"

    override func viewDidLoad() {
        super.viewDidLoad()
        handleShare()
    }

    private func handleShare() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = item.attachments?.first else {
            completeAndExit()
            return
        }

        if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                guard let text = data as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    self?.completeAndExit()
                    return
                }
                self?.store(payload: ["type": "text", "text": text])
                self?.openHostAppAndComplete()
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
            completeAndExit()
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
            completeAndExit()
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

    private func openHostAppAndComplete() {
        guard let url = URL(string: "canopy://share") else {
            completeAndExit()
            return
        }
        // extensionContext.open(_:) is the documented API for an extension to
        // ask the OS to open a URL in the host app -- UIApplication.shared
        // isn't available from an extension process at all.
        extensionContext?.open(url, completionHandler: { [weak self] _ in
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
