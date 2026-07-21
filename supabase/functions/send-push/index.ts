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
// For native Android push (FCM, via a Firebase service account):
//   FCM_PROJECT_ID    = Firebase project ID (e.g. canopy-98049)
//   FCM_CLIENT_EMAIL  = service account "client_email" field
//   FCM_PRIVATE_KEY   = service account "private_key" field (PEM, \n may be literal or real newlines)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.
//
// family_members has one token slot per platform (push_token_ios,
// push_token_android, push_token_web) rather than a single shared column —
// a person using multiple devices gets pushed on all of them, and one
// device registering doesn't clobber another's token.

// @ts-ignore
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey         = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(supabaseUrl, serviceRoleKey)

// ── APNs JWT ──────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function apnsJwt(keyId: string, teamId: string, pem: string): Promise<string> {
  const enc = new TextEncoder()
  const pemBody = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
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

async function sendApns(deviceToken: string, title: string, body: string, url: string) {
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
      url,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`APNs ${res.status}: ${(err as any).reason ?? res.statusText}`)
  }
}

// ── FCM (Android) via a Firebase service account ────────────────
// FCM's HTTP v1 API needs a short-lived OAuth2 access token, obtained by
// signing a JWT with the service account's private key (RS256) and
// exchanging it at Google's token endpoint — same shape as the APNs JWT
// above, but RSA instead of EC, and there's a token-exchange round trip.

async function fcmAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const enc = new TextEncoder()
  const pemBody = privateKeyPem
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header  = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64url(enc.encode(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`))
  const jwt = `${header}.${payload}.${b64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`FCM token exchange ${res.status}: ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token
}

async function sendFcm(deviceToken: string, title: string, body: string, url: string) {
  const projectId  = Deno.env.get('FCM_PROJECT_ID')
  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL')
  const privateKey  = Deno.env.get('FCM_PRIVATE_KEY')

  if (!projectId || !clientEmail || !privateKey) throw new Error('FCM secrets not configured')

  const accessToken = await fcmAccessToken(clientEmail, privateKey)
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        data: { url },
      },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`FCM ${res.status}: ${(err as any).error?.message ?? res.statusText}`)
  }
}

// ── Auth guard ────────────────────────────────────────────────
// Accepts either:
//   • The service role key  — server-to-server calls (e.g. delete-account)
//   • A valid user JWT      — client calls; user must be a member of the
//                             target family_id

async function authorise(authHeader: string | null, family_id: string): Promise<boolean> {
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')

  // Server-to-server: service role key bypasses family membership check
  if (token === serviceRoleKey) return true

  // User JWT: verify and confirm membership of the target family
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return false

  const { data } = await supabase
    .from('family_members')
    .select('id')
    .eq('family_id', family_id)
    .eq('user_id', user.id)
    .maybeSingle()
  return !!data
}

// ── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const authHeader = req.headers.get('Authorization')
  const { family_id, recipient_role, title, body, url = '/' } = await req.json()

  if (!family_id || !recipient_role) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: CORS })
  }

  if (!await authorise(authHeader, family_id)) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  // .eq('role', recipient_role) without .single(): 'parent_a'/'parent_b' are
  // always unique per family, but 'third_party' isn't -- a family can have
  // multiple carers (e.g. Michelle and Rose), and .single() would throw for
  // any of them instead of just silently picking one. Fetching all matching
  // rows and sending to everyone found handles both cases uniformly.
  const { data: members } = await supabase
    .from('family_members')
    .select('user_id, push_token_ios, push_token_android, push_token_web')
    .eq('family_id', family_id)
    .eq('role', recipient_role)

  const targets: Array<{ platform: string; userId: string; send: () => Promise<void> }> = []
  for (const member of members ?? []) {
    if (member.push_token_ios) {
      targets.push({ platform: 'ios', userId: member.user_id, send: () => sendApns(member.push_token_ios, title, body, url) })
    }
    if (member.push_token_android) {
      targets.push({ platform: 'android', userId: member.user_id, send: () => sendFcm(member.push_token_android, title, body, url) })
    }
    if (member.push_token_web) {
      targets.push({
        platform: 'web',
        userId: member.user_id,
        send: async () => {
          const vapidSubject = Deno.env.get('VAPID_SUBJECT')
          const vapidPublic  = Deno.env.get('VAPID_PUBLIC')
          const vapidPrivate = Deno.env.get('VAPID_PRIVATE')
          if (!vapidSubject || !vapidPublic || !vapidPrivate) throw new Error('VAPID not configured')
          webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
          await webpush.sendNotification(
            JSON.parse(member.push_token_web),
            JSON.stringify({ title, body, url }),
          )
        },
      })
    }
  }

  if (targets.length === 0) {
    return new Response(JSON.stringify({ skipped: 'no push token' }), { status: 200, headers: CORS })
  }

  // Send to every registered device for every matching person — a parent
  // using both an iPhone and an Android device should get it on both, not
  // just whichever registered most recently, and multiple carers should all
  // get notified, not just one.
  const results = await Promise.allSettled(targets.map((t) => t.send()))
  const errors: Record<string, string> = {}
  const expiredWebUserIds = new Set<string>()
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors[`${targets[i].platform}:${targets[i].userId}`] = r.reason?.message ?? String(r.reason)
      if (targets[i].platform === 'web' && r.reason?.statusCode === 410) expiredWebUserIds.add(targets[i].userId)
    }
  })

  if (expiredWebUserIds.size > 0) {
    await supabase.from('family_members').update({ push_token_web: null })
      .eq('family_id', family_id).in('user_id', Array.from(expiredWebUserIds))
  }

  if (Object.keys(errors).length > 0) console.error('Push error(s):', errors)

  if (Object.keys(errors).length === targets.length) {
    // Every target failed
    return new Response(JSON.stringify({ error: errors }), { status: 502, headers: CORS })
  }
  return new Response(JSON.stringify({ ok: true, errors: Object.keys(errors).length ? errors : undefined }), { status: 200, headers: CORS })
})
