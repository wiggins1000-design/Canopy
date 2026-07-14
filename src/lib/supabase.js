// supabase.js — shared Supabase client and notification helpers.
//
// A single client instance is exported so React Query / hooks share the same
// connection pool and realtime websocket. Push subscription helpers live here
// because they write to family_members.push_token_* columns and need the client anyway.
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// ── Push subscription helpers ─────────────────────────────────

// True when running inside the Capacitor iOS/Android wrapper
export const isNativePlatform = () => Capacitor.isNativePlatform()

// Register for native push (APNs on iOS, FCM on Android, via Capacitor).
// Stores the device token in its own per-platform column
// (push_token_ios / push_token_android) so a second device registering
// doesn't overwrite the first — a parent using both an iPhone and an
// Android device gets pushed on both.
export async function registerNativePush(userId) {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const { receive } = await PushNotifications.requestPermissions()
  if (receive !== 'granted') return { granted: false, denied: true }

  const column = Capacitor.getPlatform() === 'ios' ? 'push_token_ios' : 'push_token_android'

  let resolve
  const promise = new Promise((r) => { resolve = r })

  const regHandle = await PushNotifications.addListener('registration', async (token) => {
    await supabase
      .from('family_members')
      .update({ [column]: token.value })
      .eq('user_id', userId)
    resolve({ granted: true })
  })

  const errHandle = await PushNotifications.addListener('registrationError', (err) => {
    resolve({ granted: false, error: err?.error ?? 'registration_error' })
  })

  PushNotifications.register().catch(() => resolve({ granted: false, error: 'register_failed' }))

  const timeout = setTimeout(() => resolve({ granted: false, error: 'timeout' }), 15000)
  const result = await promise
  clearTimeout(timeout)
  regHandle.remove()
  errHandle.remove()

  return result
}

export async function unregisterNativePush(userId) {
  // APNs/FCM tokens can't be revoked from the client — just clear from DB
  const column = Capacitor.getPlatform() === 'ios' ? 'push_token_ios' : 'push_token_android'
  await supabase.from('family_members').update({ [column]: null }).eq('user_id', userId)
}

export async function registerPushSubscription(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  const reg = await navigator.serviceWorker.ready
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) return

  try {
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })

    await supabase
      .from('family_members')
      .update({ push_token_web: JSON.stringify(sub) })
      .eq('user_id', userId)
  } catch (err) {
    console.warn('Push registration failed:', err)
  }
}

export async function sendPushNotification({ familyId, recipientRole, title, body, url }) {
  return await supabase.functions.invoke('send-push', {
    body: { family_id: familyId, recipient_role: recipientRole, title, body, url },
  })
}

export async function unregisterPushSubscription(userId) {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
    await supabase.from('family_members').update({ push_token_web: null }).eq('user_id', userId)
  } catch (err) {
    console.warn('Push unregister failed:', err)
  }
}

export async function sendSmsNotification({ familyId, recipientRole, authorName }) {
  await supabase.functions.invoke('send-sms', {
    body: {
      family_id:      familyId,
      recipient_role: recipientRole,
      author_name:    authorName,
      app_url:        `${window.location.origin}/board`,
    },
  })
}

// Normalise image_url / file_url to a bare storage path.
// Old posts stored full public URLs; new posts store just the path.
export function toStoragePath(urlOrPath, bucket = 'notice-attachments') {
  if (!urlOrPath) return null
  if (!urlOrPath.startsWith('http')) return urlOrPath
  const marker = `/${bucket}/`
  const idx = urlOrPath.indexOf(marker)
  return idx !== -1 ? urlOrPath.slice(idx + marker.length) : urlOrPath
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}
