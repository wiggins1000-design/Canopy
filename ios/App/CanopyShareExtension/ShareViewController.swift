// Canopy's WhatsApp/OS share-sheet entry point on iOS.
//
// This file belongs to the CanopyShareExtension target (created in Xcode via
// File > New > Target > Share Extension), NOT the main App target. It runs in
// its own separate process with no direct access to the running app or its JS
// runtime, so its only job is: read whatever was shared, append it into a
// shared App Group container's queue, then hand off to the main app via the
// canopy:// URL scheme. CanopySharePlugin.swift (in the main App target)
// picks it up from there -- see that file's header comment for the full round
// trip.
//
// Shows no UI at all -- the OS's own "opening Canopy..." transition is the
// only visible feedback, matching the instant one-tap feel of the Android
// share-target flow.
import UIKit
import UniformTypeIdentifiers

@objc
public class ShareViewController: UIViewController {

    static let appGroupId = "group.app.canopy.app.share"
    static let pendingShareKey = "canopy_pending_share"

    public override func viewDidLoad() {
        super.viewDidLoad()
        handleShare()
    }

    private func handleShare() {
        // WhatsApp's "forward multiple selected messages" delivers each
        // message as its own NSExtensionItem in inputItems -- not as multiple
        // attachments on one item, and not concatenated into one item either.
        // Reading only .first here silently dropped every message but the
        // first (and made re-sharing the same batch look like a duplicate,
        // since it just re-extracted that same first message every time).
        guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
            openHostAppAndComplete()
            return
        }

        let group = DispatchGroup()

        for item in items {
            guard let attachments = item.attachments, !attachments.isEmpty else {
                // Some apps (WhatsApp forwarded text, in particular) deliver
                // plain text via attributedContentText instead of populating
                // attachments at all -- without this fallback the extension
                // used to exit silently here, which looks like "nothing
                // happens" from the sending app's side.
                if let text = item.attributedContentText?.string,
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    enqueue(payload: ["type": "text", "text": text])
                }
                continue
            }

            for attachment in attachments {
                group.enter()
                processAttachment(attachment) { group.leave() }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.openHostAppAndComplete()
        }
    }

    private func processAttachment(_ attachment: NSItemProvider, completion: @escaping () -> Void) {
        if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            // loadDataRepresentation sidesteps NSItemProviderReading class-
            // bridging entirely (raw bytes, decoded as UTF-8 manually) -- but
            // some sending apps' NSItemProvider only implements the older
            // loadItem(forTypeIdentifier:) selector-based mechanism and has
            // nothing to hand back to the newer data-representation API, so
            // fall back to that rather than assuming which one a given
            // sending app supports.
            attachment.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, _ in
                if let data = data, let text = String(data: data, encoding: .utf8),
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self?.enqueue(payload: ["type": "text", "text": text])
                    completion()
                    return
                }
                attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] reading, _ in
                    let text = (reading as? String) ?? (reading as? NSString) as String?
                    if let text = text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        self?.enqueue(payload: ["type": "text", "text": text])
                    }
                    completion()
                }
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] data, _ in
                self?.handleFileAttachment(data, kind: "image")
                completion()
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { [weak self] data, _ in
                self?.handleFileAttachment(data, kind: "pdf")
                completion()
            }
        } else {
            completion()
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

        if let fileBytes = bytes, !fileBytes.isEmpty {
            if kind == "image" {
                // Same lesson learned the hard way on Android: don't trust the
                // OS/sending-app-reported type -- sniff the actual file bytes'
                // magic number instead, since it's authoritative regardless of
                // what any UTI metadata claims.
                let mediaType = ShareViewController.sniffImageMediaType(fileBytes) ?? "image/jpeg"
                enqueue(payload: ["type": "image", "base64": fileBytes.base64EncodedString(), "mediaType": mediaType])
            } else {
                enqueue(payload: ["type": "pdf", "base64": fileBytes.base64EncodedString()])
            }
        }
    }

    // Appends to the queue rather than overwriting it -- sharing several
    // things before the app is next opened used to silently lose everything
    // but the last one, since this used to store a single value. Now that a
    // single share action can enqueue several items concurrently (multiple
    // NSExtensionItems, each on its own possibly-background completion
    // thread -- see handleShare), the read-modify-write below needs to be
    // serialized or concurrent enqueues can race and clobber each other.
    private static let enqueueQueue = DispatchQueue(label: "app.canopy.share.enqueue")

    private func enqueue(payload: [String: Any]) {
        ShareViewController.enqueueQueue.sync {
            guard let defaults = UserDefaults(suiteName: ShareViewController.appGroupId) else { return }
            var pending: [[String: Any]] = []
            if let existingData = defaults.data(forKey: ShareViewController.pendingShareKey),
               let existingArray = (try? JSONSerialization.jsonObject(with: existingData)) as? [[String: Any]] {
                pending = existingArray
            }
            pending.append(payload)
            guard let json = try? JSONSerialization.data(withJSONObject: pending) else { return }
            defaults.set(json, forKey: ShareViewController.pendingShareKey)
        }
    }

    private func openHostAppAndComplete() {
        // NSItemProvider completion handlers (loadDataRepresentation/loadItem)
        // are explicitly documented as NOT guaranteed to run on the main
        // thread -- this function is called from inside those completion
        // handlers, and extensionContext.open(_:) is a UIKit-adjacent API that
        // needs to run on the main thread to behave reliably.
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.openHostAppAndComplete() }
            return
        }
        guard let url = URL(string: "canopy://share") else {
            completeAndExit()
            return
        }
        // extensionContext.open(_:) is the documented API for an extension to
        // ask the OS to open a URL in the host app -- UIApplication.shared
        // isn't available from an extension process at all. This can still
        // fail to bring Canopy to the foreground automatically on some iOS
        // versions (a known Share Extension limitation) -- when it does, the
        // shared content still waits in the queue above for whenever the user
        // next opens Canopy themselves.
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
