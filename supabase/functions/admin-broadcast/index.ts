// Canopy — admin-broadcast edge function
// Sends a bulk email to a filtered segment of Canopy parents via Resend.
// Segments: 'all' | 'inactive_30' | 'locale_en-GB' | 'locale_en-AU' | 'locale_en-IE' | 'locale_en-US'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: adminRow } = await supabase
    .from('admin_accounts')
    .select('user_id')
    .eq('user_id', user.id)
    .single()
  if (!adminRow) return new Response('Forbidden', { status: 403, headers: CORS })

  const { segment = 'all', subject, body_html, preview_only = false } = await req.json()

  if (!subject || !body_html) {
    return new Response(JSON.stringify({ error: 'subject and body_html are required' }), { status: 400, headers: CORS })
  }

  // Use the RPC which handles all segment logic (all, inactive_30, locale_*)
  // and correctly joins auth.users for emails
  const { data: recipients, error: recError } = await supabase
    .rpc('admin_get_broadcast_recipients', { p_segment: segment })

  if (recError) {
    return new Response(JSON.stringify({ error: recError.message }), { status: 500, headers: CORS })
  }

  // Deduplicate by email
  const seen = new Set<string>()
  const uniqueRecipients = (recipients ?? []).filter((r: { email: string }) => {
    if (seen.has(r.email)) return false
    seen.add(r.email)
    return true
  })

  if (preview_only) {
    return new Response(
      JSON.stringify({ recipient_count: uniqueRecipients.length }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // Send in batches of 50 (Resend batch limit)
  const BATCH = 50
  let sent = 0
  let failed = 0

  for (let i = 0; i < uniqueRecipients.length; i += BATCH) {
    const batch = uniqueRecipients.slice(i, i + BATCH)
    const emails = batch.map((r: { email: string }) => ({
      from: 'Canopy <noreply@canopy-app.app>',
      to:   [r.email],
      subject,
      html: body_html,
    }))

    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emails),
    })

    if (res.ok) sent += batch.length
    else {
      const err = await res.text()
      console.error('Resend batch error:', err)
      failed += batch.length
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent, failed }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
