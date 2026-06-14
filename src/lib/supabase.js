// supabase.js — shared Supabase client and notification helpers.
//
// A single client instance is exported so React Query / hooks share the same
// connection pool and realtime websocket. Push subscription helpers live here
// because they write to family_members.push_token and need the client anyway.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// ── Push subscription helpers ─────────────────────────────────

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
      .update({ push_token: JSON.stringify(sub) })
      .eq('user_id', userId)
  } catch (err) {
    console.warn('Push registration failed:', err)
  }
}

export async function sendPushNotification({ familyId, recipientRole, title, body, url }) {
  await supabase.functions.invoke('send-push', {
    body: { family_id: familyId, recipient_role: recipientRole, title, body, url },
  })
}

export async function unregisterPushSubscription(userId) {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
    await supabase.from('family_members').update({ push_token: null }).eq('user_id', userId)
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
