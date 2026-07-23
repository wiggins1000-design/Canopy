import { registerPlugin } from '@capacitor/core'

// Local, unpublished Capacitor plugin -- native implementations live directly
// in the iOS/Android projects (android/app/src/main/java/app/canopy/app/CanopySharePlugin.java,
// ios/App/App/CanopySharePlugin.swift), not in node_modules. Bridges the OS
// share sheet (e.g. "Share" from WhatsApp) into JS. See AppLayout.jsx for how
// this is consumed.
//
// SharePayload shape:
//   { type: 'text', text: string }
//   { type: 'image', base64: string, mediaType: string }
//   { type: 'pdf', base64: string }
//
// getPendingShares()/the shareReceived listener always deal in arrays --
// sharing several things before the app is next opened queues them natively
// rather than the last one silently overwriting the rest.
const CanopyShare = registerPlugin('CanopyShare')

// sessionStorage key used to hand received share payloads (an array, even
// for a single share) from AppLayout.jsx (where the native listener/pull
// lives) to AddFromSharePage.jsx (where it's consumed) across a navigation.
// Defined here, not in the page component, so importing it doesn't defeat
// AddFromSharePage's lazy-loading in App.jsx.
export const PENDING_SHARE_KEY = 'canopy_pending_share'

export default CanopyShare
