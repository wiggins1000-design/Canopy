// Canopy — Supabase Edge Function: send-sms
// Sends an SMS via Telnyx when an urgent notice board post is created.
//
// Set these secrets in the Supabase dashboard (Project → Settings → Edge Functions → Secrets):
//   TELNYX_API_KEY     = "KEY01..."          (from Telnyx dashboard → API Keys)
//   TELNYX_FROM        = "Canopy"            (alphanumeric sender ID, max 11 chars)
//                        OR a Telnyx phone number e.g. "+441234567890"
//   SUPABASE_URL       = "<your project url>"
//   SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
//
// Alphanumeric sender IDs (e.g. "Canopy") are supported in the UK and most of Europe
// but NOT in the US/Canada — use a Telnyx number there instead.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(supabaseUrl, serviceRoleKey)

// ── Auth guard ────────────────────────────────────────────────
// Accepts either:
//   • The service role key  — server-to-server calls
//   • A valid user JWT      — client calls; user must be a member of the
//                             target family_id

async function authorise(authHeader: string | null, family_id: string): Promise<boolean> {
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')

  if (token === serviceRoleKey) return true

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
  const { family_id, recipient_role, author_name, app_url } = await req.json()

  if (!family_id || !recipient_role) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: CORS })
  }

  if (!await authorise(authHeader, family_id)) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  // Alphanumeric sender ID "Canopy" is only compliant in the UK today — Ireland
  // blocks unregistered senders outright since 2025-10-03, Australia downgrades
  // them to "Unverified" since 1 July 2026, and New Zealand can't use alphanumeric
  // senders at all. Rather than send degraded/blocked messages, skip entirely
  // outside en-GB until each locale's sender ID is properly registered.
  const { data: family } = await supabase
    .from('families')
    .select('config')
    .eq('id', family_id)
    .single()

  if (family?.config?.locale !== 'en-GB') {
    return new Response(JSON.stringify({ skipped: 'sms not yet available in this locale' }), { status: 200, headers: CORS })
  }

  const { data: member } = await supabase
    .from('family_members')
    .select('phone_number')
    .eq('family_id', family_id)
    .eq('role', recipient_role)
    .single()

  if (!member?.phone_number) {
    return new Response(JSON.stringify({ skipped: 'no phone number' }), { status: 200, headers: CORS })
  }

  const apiKey = Deno.env.get('TELNYX_API_KEY')
  const from   = Deno.env.get('TELNYX_FROM')

  if (!apiKey || !from) {
    return new Response(JSON.stringify({ error: 'SMS not configured' }), { status: 500, headers: CORS })
  }

  const text = `${author_name} has posted an urgent notice on Canopy. Open the app to read it: ${app_url ?? 'https://my.canopy-app.app/board'}`

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: member.phone_number,
      text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Telnyx error:', err)
    return new Response(JSON.stringify({ error: err }), { status: 502, headers: CORS })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
})
