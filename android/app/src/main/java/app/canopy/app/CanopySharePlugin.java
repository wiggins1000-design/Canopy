package app.canopy.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

// Bridges Android's OS share sheet (e.g. "Share" from WhatsApp) into JS.
// Capacitor's BridgeActivity already calls onNewIntent(getIntent()) on both
// cold start and warm relaunch (see BridgeActivity.load()), and dispatches it
// to every registered plugin's handleOnNewIntent() -- so no custom
// onCreate/onNewIntent override is needed in MainActivity beyond registering
// this plugin.
@CapacitorPlugin(name = "CanopyShare")
public class CanopySharePlugin extends Plugin {

    // Cold-launch case: JS calls getPendingShare() on mount, after
    // handleOnNewIntent() has already run and populated this.
    private static JSObject pendingShare = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject share = parseShareIntent(intent);
        if (share != null) {
            pendingShare = share;
            // Warm-launch case: fires immediately if a JS listener is already
            // attached. Harmless no-op if nothing is listening yet -- the
            // cold-launch pull above covers that case instead.
            notifyListeners("shareReceived", share);
        }
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject result = new JSObject();
        result.put("share", pendingShare);
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingShare(PluginCall call) {
        pendingShare = null;
        call.resolve();
    }

    private JSObject parseShareIntent(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        String type = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) || type == null) return null;

        try {
            if ("text/plain".equals(type)) {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text == null || text.trim().isEmpty()) return null;
                JSObject result = new JSObject();
                result.put("type", "text");
                result.put("text", text);
                return result;
            }

            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return null;
            byte[] bytes = readUriBytes(uri);
            if (bytes == null || bytes.length == 0) return null;
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

            if (type.startsWith("image/")) {
                JSObject result = new JSObject();
                result.put("type", "image");
                result.put("base64", base64);
                result.put("mediaType", resolveImageMediaType(type, bytes));
                return result;
            } else if ("application/pdf".equals(type)) {
                JSObject result = new JSObject();
                result.put("type", "pdf");
                result.put("base64", base64);
                return result;
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    // Claude's vision API only accepts exactly image/jpeg, image/png,
    // image/gif, or image/webp. The OS-reported type is not always one of
    // these -- some apps report the non-standard "image/jpg" instead of
    // "image/jpeg", and WhatsApp specifically has been observed sending the
    // literal wildcard "image/*" with no concrete subtype at all. When the
    // reported type isn't already a valid concrete value, sniff the actual
    // file bytes' magic number instead, which is authoritative regardless of
    // what any app/provider metadata claims.
    private String resolveImageMediaType(String reportedType, byte[] bytes) {
        String lower = reportedType.toLowerCase(Locale.ROOT);
        if (lower.equals("image/jpg") || lower.equals("image/pjpeg")) lower = "image/jpeg";
        if (isValidClaudeImageType(lower)) return lower;

        String sniffed = sniffImageMediaType(bytes);
        return sniffed != null ? sniffed : "image/jpeg"; // last-resort guess -- most common case
    }

    private boolean isValidClaudeImageType(String type) {
        return type.equals("image/jpeg") || type.equals("image/png") || type.equals("image/gif") || type.equals("image/webp");
    }

    private String sniffImageMediaType(byte[] b) {
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) {
            return "image/png";
        }
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8'
                && (b[4] == '7' || b[4] == '9') && b[5] == 'a') {
            return "image/gif";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        return null;
    }

    // Inbound share URIs come from the SENDING app's own content provider
    // (e.g. WhatsApp's), not Canopy's -- a plain ContentResolver read, no
    // involvement of Canopy's own FileProvider (that's for outbound shares,
    // see ExportPage.jsx).
    private byte[] readUriBytes(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        InputStream is = resolver.openInputStream(uri);
        if (is == null) return null;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int len;
        while ((len = is.read(chunk)) != -1) {
            buffer.write(chunk, 0, len);
        }
        is.close();
        return buffer.toByteArray();
    }
}
