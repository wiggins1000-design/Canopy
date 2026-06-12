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

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const { family_id, recipient_role, author_name, app_url } = await req.json()

  if (!family_id || !recipient_role) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: CORS })
  }

  // Look up the recipient's phone number
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
