// Canopy — admin-triggered failure clustering for a selected time period.
//
// Collates recent failures from either the term-dates scraper (school_calendars)
// or FamilyFeed email processing (email_processing_log) and asks Claude to cluster
// them into root causes with counts and a suggested fix area — a development
// backlog a human (or another Claude session) can act on, not an auto-patch.
//
// Deliberately excludes family-identifying fields (family_name, email subject,
// from_email) from what's sent to Claude — only structural failure data
// (error type/stage, error message, diagnosis, affected URL/domain) is needed
// to spot code-level patterns.

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

  const { type, from, to } = await req.json()
  if (type !== 'term_dates' && type !== 'familyfeed') {
    return new Response(JSON.stringify({ error: 'type must be term_dates or familyfeed' }), { status: 400, headers: CORS })
  }
  if (!from || !to) {
    return new Response(JSON.stringify({ error: 'from and to dates are required' }), { status: 400, headers: CORS })
  }

  const fromIso = new Date(from).toISOString()
  const toIso   = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString() // inclusive of the "to" day

  let items: string[] = []
  let totalCount = 0

  if (type === 'term_dates') {
    // school_calendars stores current status only (upserted per school), not a
    // history — so this reflects schools currently failing whose last failure
    // falls in the window, not every failure that ever happened in it.
    const { data, error } = await supabase
      .from('school_calendars')
      .select('homepage_url, scrape_error, scrape_diagnosis, scrape_error_at')
      .not('scrape_error', 'is', null)
      .gte('scrape_error_at', fromIso)
      .lt('scrape_error_at', toIso)
      .order('scrape_error_at', { ascending: false })
      .limit(300)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS })

    totalCount = data?.length ?? 0
    items = (data ?? []).map((s) => {
      const err = s.scrape_error as any
      const lines = [
        `Domain: ${new URL(s.homepage_url).hostname}`,
        `Error type: ${err?.error_type ?? 'unknown'}`,
        `Error message: ${err?.error_message ?? ''}`,
      ]
      if (s.scrape_diagnosis) lines.push(`Diagnosis: ${s.scrape_diagnosis}`)
      return lines.join('\n')
    })
  } else {
    const { data, error } = await supabase
      .from('email_processing_log')
      .select('error_stage, error_message, diagnosis, created_at')
      .eq('status', 'error')
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS })

    totalCount = data?.length ?? 0
    items = (data ?? []).map((r) => {
      const lines = [
        `Failure stage: ${r.error_stage ?? 'unknown'}`,
        `Error message: ${(r.error_message ?? '').slice(0, 300)}`,
      ]
      if (r.diagnosis) lines.push(`Diagnosis: ${r.diagnosis}`)
      return lines.join('\n')
    })
  }

  if (items.length === 0) {
    return new Response(JSON.stringify({ ok: true, total_count: 0, analysis: null }), { status: 200, headers: CORS })
  }

  const subjectLabel = type === 'term_dates'
    ? 'an automated school term-dates scraper (supports UK, US, Australia and Ireland school websites)'
    : "Canopy's FamilyFeed feature, which reads forwarded parent emails (and PDF/Word/HTML attachments and links) with Claude to extract calendar events"

  const prompt = `You are helping a developer triage recent failures from ${subjectLabel}.

Below are ${items.length} failure records (capped at 300) from the selected period. Cluster them into root causes.

${items.map((it, i) => `--- Failure ${i + 1} ---\n${it}`).join('\n\n')}

Respond in this exact format, plain text, no markdown headers:

For each distinct root cause cluster, one block:
Cluster: <short name for the root cause>
Count: <how many of the failures above match this cluster>
Example: <one representative domain/error message from this cluster>
Likely cause: <1-2 sentences>
Suggested fix: <1-2 sentences — concrete enough that a developer could act on it, e.g. "add X domain to the JS-render allowlist", "raise the Y timeout", "broaden the Z regex to include...">

List clusters largest-count first. If a failure doesn't fit any cluster with at least 2 members, group remaining ones under a final "Cluster: Other / one-off" block.`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.text()
    return new Response(JSON.stringify({ error: 'AI error', detail: err }), { status: 502, headers: CORS })
  }

  const aiData = await aiRes.json()
  const analysis: string = aiData.content?.[0]?.text ?? ''

  return new Response(JSON.stringify({ ok: true, total_count: totalCount, analysis }), { status: 200, headers: CORS })
})
