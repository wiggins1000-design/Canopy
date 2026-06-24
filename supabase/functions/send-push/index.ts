// Canopy — Supabase Edge Function: send-push
//
// Secrets required (Supabase dashboard → Edge Functions → Secrets):
//
// For web-push (browsers):
//   VAPID_SUBJECT  = "mailto:your@email.com"
//   VAPID_PUBLIC   = "<your vapid public key>"
//   VAPID_PRIVATE  = "<your vapid private key>"
//
// For native iOS push (APNs):
//   APNS_KEY_ID     = 10-char key ID from developer.apple.com → Keys
//   APNS_TEAM_ID    = Apple Developer Team ID (e.g. 9XAJ23G5YF)
//   APNS_BUNDLE_ID  = app.canopy.app
//   APNS_PRIVATE_KEY = contents of the .p8 key file (paste full PEM including header/footer)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.

// @ts-ignore
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── APNs JWT ──────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function apnsJwt(keyId: string, teamId: string, pem: string): Promise<string> {
  const enc = new TextEncoder()
  const pemBody = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )
  const header  = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })))
  const payload = b64url(enc.encode(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })))
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    enc.encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${b64url(sig)}`
}

async function sendApns(deviceToken: string, title: string, body: string) {
  const keyId     = Deno.env.get('APNS_KEY_ID')
  const teamId    = Deno.env.get('APNS_TEAM_ID')
  const bundleId  = Deno.env.get('APNS_BUNDLE_ID') ?? 'app.canopy.app'
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY')

  if (!keyId || !teamId || !privateKey) throw new Error('APNs secrets not configured')

  const jwt = await apnsJwt(keyId, teamId, privateKey)
  const res = await fetch(`https://api.push.apple.com/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      aps: { alert: { title, body }, sound: 'default' },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`APNs ${res.status}: ${(err as any).reason ?? res.statusText}`)
  }
}

// ── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const { family_id, recipient_role, title, body, url = '/' } = await req.json()

  if (!family_id || !recipient_role) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: CORS })
  }

  const { data: member } = await supabase
    .from('family_members')
    .select('push_token')
    .eq('family_id', family_id)
    .eq('role', recipient_role)
    .single()

  if (!member?.push_token) {
    return new Response(JSON.stringify({ skipped: 'no push token' }), { status: 200, headers: CORS })
  }

  try {
    if (member.push_token.startsWith('apns:')) {
      // Native iOS push via APNs
      await sendApns(member.push_token.slice(5), title, body)
    } else {
      // Web push via VAPID
      const vapidSubject = Deno.env.get('VAPID_SUBJECT')
      const vapidPublic  = Deno.env.get('VAPID_PUBLIC')
      const vapidPrivate = Deno.env.get('VAPID_PRIVATE')
      if (!vapidSubject || !vapidPublic || !vapidPrivate) {
        return new Response(JSON.stringify({ error: 'VAPID not configured' }), { status: 500, headers: CORS })
      }
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
      await webpush.sendNotification(
        JSON.parse(member.push_token),
        JSON.stringify({ title, body, url }),
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
  } catch (err: any) {
    if (err.statusCode === 410) {
      // Web-push: subscription expired — clear it
      await supabase
        .from('family_members')
        .update({ push_token: null })
        .eq('family_id', family_id)
        .eq('role', recipient_role)
    }
    console.error('Push error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: CORS })
  }
})
