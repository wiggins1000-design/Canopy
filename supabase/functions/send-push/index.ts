// Canopy — Supabase Edge Function: send-push
//
// Secrets required (Supabase dashboard → Edge Functions → Secrets):
//   VAPID_SUBJECT  = "mailto:your@email.com"
//   VAPID_PUBLIC   = "<your vapid public key>"   (same as VITE_VAPID_PUBLIC_KEY in .env)
//   VAPID_PRIVATE  = "<your vapid private key>"  (never expose client-side)
//   SUPABASE_URL   = (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY = (auto-injected)

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

  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const vapidPublic  = Deno.env.get('VAPID_PUBLIC')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE')

  if (!vapidSubject || !vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID not configured' }), { status: 500, headers: CORS })
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  try {
    await webpush.sendNotification(
      JSON.parse(member.push_token),
      JSON.stringify({ title, body, url }),
    )
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
  } catch (err: any) {
    // 410 Gone means the subscription is no longer valid — clear it from DB
    if (err.statusCode === 410) {
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
