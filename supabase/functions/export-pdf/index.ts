// Canopy — Supabase Edge Function: export-pdf
//
// Generates a Verified Family Record PDF export of a family's:
//   - Schedule change history (with holiday flag)
//   - Notice board posts
//   - Calendar events
//
// Returns the PDF as a base64-encoded string (suitable for download in a PWA).
//
// ── Request body ──────────────────────────────────────────────────────────────
//   {
//     sections: ['changes', 'posts', 'events'],  // which sections to include
//     from_date: 'YYYY-MM-DD',                   // optional start filter
//     to_date:   'YYYY-MM-DD',                   // optional end filter
//   }
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUPABASE_ANON_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy export-pdf --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: memberRow } = await supabase
    .from('family_members')
    .select('family_id, role, display_name')
    .eq('user_id', user.id)
    .single()
  if (!memberRow) return new Response('No family found', { status: 404, headers: CORS })

  const familyId = memberRow.family_id

  let body: any = {}
  try { body = await req.json() } catch { /* optional body */ }

  const sections  = body.sections ?? ['changes', 'posts', 'events']
  const fromDate  = body.from_date ?? null
  const toDate    = body.to_date   ?? null

  // ── Fetch data ──────────────────────────────────────────────────────────

  const { data: family }  = await supabase.from('families').select('name').eq('id', familyId).single()
  const { data: members } = await supabase.from('family_members').select('user_id, display_name, role').eq('family_id', familyId)

  const paName = members?.find(m => m.role === 'parent_a')?.display_name ?? 'Parent A'
  const pbName = members?.find(m => m.role === 'parent_b')?.display_name ?? 'Parent B'

  const memberMap: Record<string, string> = {}
  for (const m of members ?? []) memberMap[m.user_id] = m.display_name ?? m.role

  let changes: any[] = []
  let posts:   any[] = []
  let events:  any[] = []

  if (sections.includes('changes')) {
    let q = supabase
      .from('schedule_changes')
      .select('*')
      .eq('family_id', familyId)
      .order('start_date', { ascending: false })
    if (fromDate) q = q.gte('start_date', fromDate)
    if (toDate)   q = q.lte('start_date', toDate)
    const { data } = await q
    changes = data ?? []
  }

  if (sections.includes('posts')) {
    let q = supabase
      .from('notice_posts')
      .select('*')
      .eq('family_id', familyId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (fromDate) q = q.gte('created_at', fromDate)
    if (toDate)   q = q.lte('created_at', toDate + 'T23:59:59Z')
    const { data } = await q
    posts = data ?? []
  }

  if (sections.includes('events')) {
    let q = supabase
      .from('family_events')
      .select('*')
      .eq('family_id', familyId)
      .order('event_date', { ascending: false })
    if (fromDate) q = q.gte('event_date', fromDate)
    if (toDate)   q = q.lte('event_date', toDate)
    const { data } = await q
    events = data ?? []
  }

  // ── Build PDF as HTML (rendered to text for download) ────────────────────
  // We generate a structured HTML document that can be:
  // - Printed by the browser to PDF (via print dialog)
  // - Sent directly as HTML for parsing
  //
  // Note: Deno Edge Functions don't have Puppeteer/headless browser available.
  // The client receives HTML which it opens in a new window for the user to print as PDF.

  const now   = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
  const title = `${family?.name ?? 'Family'} — Verified Family Record`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; }
  h1 { font-size: 22px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 32px; }
  h2 { font-size: 16px; margin-top: 36px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 8px; background: #f5f5f5; border: 1px solid #ddd; font-weight: bold; }
  td { padding: 6px 8px; border: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  .holiday-badge { background: #fef3c7; color: #92400e; padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: bold; }
  .status-pending { color: #d97706; } .status-approved { color: #059669; } .status-rejected { color: #dc2626; }
  .disclaimer { margin-top: 48px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
<p class="meta">Generated: ${now} &nbsp;|&nbsp; ${paName} &amp; ${pbName}</p>

${sections.includes('changes') && changes.length > 0 ? `
<h2>Schedule Changes &amp; Holiday Requests (${changes.length})</h2>
<table>
<thead><tr>
  <th>Type</th><th>Dates</th><th>Requested by</th><th>Assigned to</th><th>Status</th><th>Note</th><th>Submitted</th>
</tr></thead>
<tbody>
${changes.map(c => `<tr>
  <td>${c.is_holiday ? '<span class="holiday-badge">Holiday</span>' : 'Schedule change'}</td>
  <td>${c.start_date}${c.end_date && c.end_date !== c.start_date ? ' → ' + c.end_date : ''}</td>
  <td>${escHtml(memberMap[c.requested_by] ?? '—')}</td>
  <td>${c.assigned_to === 'parent_a' ? escHtml(paName) : escHtml(pbName)}</td>
  <td class="status-${c.status}">${c.status}</td>
  <td>${escHtml(c.note ?? '')}</td>
  <td>${new Date(c.created_at).toLocaleDateString('en-GB')}</td>
</tr>`).join('')}
</tbody></table>` : sections.includes('changes') ? '<h2>Schedule Changes</h2><p>No changes in this period.</p>' : ''}

${sections.includes('posts') && posts.length > 0 ? `
<h2>Notice Board Posts (${posts.length})</h2>
<table>
<thead><tr>
  <th>Date</th><th>From</th><th>Tag</th><th>Content</th>
</tr></thead>
<tbody>
${posts.map(p => `<tr>
  <td>${new Date(p.created_at).toLocaleDateString('en-GB')}<br><span style="font-size:11px;color:#666">${new Date(p.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></td>
  <td>${escHtml(memberMap[p.author_id] ?? 'External')}</td>
  <td>${escHtml(p.tag ?? '')}</td>
  <td style="white-space:pre-wrap">${escHtml(p.content ?? '')}</td>
</tr>`).join('')}
</tbody></table>` : sections.includes('posts') ? '<h2>Notice Board Posts</h2><p>No posts in this period.</p>' : ''}

${sections.includes('events') && events.length > 0 ? `
<h2>Calendar Events (${events.length})</h2>
<table>
<thead><tr>
  <th>Date</th><th>Title</th><th>Source</th><th>Notes</th>
</tr></thead>
<tbody>
${events.map(e => `<tr>
  <td>${e.event_date}${e.end_date && e.end_date !== e.event_date ? ' → ' + e.end_date : ''}</td>
  <td>${escHtml(e.title)}</td>
  <td>${escHtml(e.source ?? 'manual')}</td>
  <td>${escHtml(e.notes ?? '')}</td>
</tr>`).join('')}
</tbody></table>` : sections.includes('events') ? '<h2>Calendar Events</h2><p>No events in this period.</p>' : ''}

<p class="disclaimer">
This document was generated by Canopy (canopy.app) and contains records from the ${escHtml(family?.name ?? '')} family account.
Timestamps are in the device's local time. This export is provided for information only and does not constitute legal advice.
All records should be verified against the original Canopy account before use in legal proceedings.
</p>
</body></html>`

  return new Response(JSON.stringify({ ok: true, html }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
