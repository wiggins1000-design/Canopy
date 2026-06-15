// Canopy — export-user-data edge function
//
// Generates a human-readable HTML document of all data held about the user
// and their family (Right of Access / Right to Portability, UK GDPR Art. 15/20).
//
// Returns { ok: true, html: "..." } — client opens HTML in a new window and
// triggers window.print() so the user can save as PDF.
//
// Excludes: OAuth tokens, push tokens, encrypted passwords, 2FA codes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function esc(s: unknown): string {
  return String(s ?? '—')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function section(title: string, content: string): string {
  return `<h2>${esc(title)}</h2>${content}`
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p class="empty">No records.</p>'
  return `<table>
<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`
}

function kv(pairs: [string, unknown][]): string {
  return `<table class="kv">${pairs.map(([k, v]) =>
    `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
  ).join('')}</table>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: member } = await supabase
    .from('family_members')
    .select('family_id, display_name, role, phone_number, consents, created_at')
    .eq('user_id', user.id)
    .single()

  if (!member) {
    return new Response(JSON.stringify({ error: 'No family membership found' }), { status: 404, headers: CORS })
  }

  const familyId = member.family_id

  const [
    { data: family },
    { data: members },
    { data: additionalEmails },
    { data: events },
    { data: notices },
    { data: messages },
    { data: expenses },
    { data: infoBank },
    { data: vaultDocs },
    { data: schedule },
    { data: scheduleChanges },
  ] = await Promise.all([
    supabase.from('families').select('id, name, config, created_at').eq('id', familyId).single(),
    supabase.from('family_members').select('display_name, role, created_at').eq('family_id', familyId),
    supabase.from('member_additional_emails').select('email, created_at').eq('user_id', user.id),
    supabase.from('family_events').select('title, event_date, end_date, event_time, notes, source, created_at').eq('family_id', familyId).order('event_date'),
    supabase.from('notice_posts').select('content, tag, created_at').eq('family_id', familyId).order('created_at', { ascending: false }),
    supabase.from('messages').select('content, created_at').eq('family_id', familyId).order('created_at', { ascending: false }),
    supabase.from('expenses').select('description, amount, paid_by, split_pct, settled, created_at').eq('family_id', familyId).order('created_at', { ascending: false }),
    supabase.from('info_bank').select('child_name, section, data, updated_at').eq('family_id', familyId),
    supabase.from('vault_documents').select('title, category, file_name, file_size, mime_type, created_at').eq('family_id', familyId),
    supabase.from('baseline_schedules').select('pattern_type, start_date, starting_parent, updated_at').eq('family_id', familyId).maybeSingle(),
    supabase.from('schedule_changes').select('start_date, end_date, assigned_to, note, status, created_at').eq('family_id', familyId).order('created_at', { ascending: false }),
  ])

  const now = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
  const memberMap: Record<string, string> = {}
  for (const m of members ?? []) memberMap[(m as any).role] = (m as any).display_name

  // ── Build HTML sections ────────────────────────────────────────────────────

  const profileHtml = section('Your account', kv([
    ['Name', member.display_name],
    ['Email', user.email],
    ['Role', member.role],
    ['Phone', member.phone_number],
    ['Additional forwarding emails', (additionalEmails ?? []).map((e: any) => e.email).join(', ') || '—'],
    ['Member since', fmtDate(member.created_at)],
    ['FamilyFeed AI consent', member.consents?.familyfeed_ai ? `Given ${fmtDate(member.consents.familyfeed_ai.at)}` : 'Not given'],
    ['Medical data consent', member.consents?.medical_data ? `Given ${fmtDate(member.consents.medical_data.at)}` : 'Not given'],
  ]))

  const familyHtml = section('Family', kv([
    ['Family name', family?.name],
    ['Family created', fmtDate(family?.created_at)],
    ['Children', (family?.config?.children ?? []).map((c: any) => c.name).join(', ') || '—'],
    ['Pets', (family?.config?.pets ?? []).map((p: any) => `${p.name} (${p.type})`).join(', ') || '—'],
    ['Changeover time', family?.config?.changeover_time],
    ['Changeover location', family?.config?.changeover_location],
    ['Family members', (members ?? []).map((m: any) => `${m.display_name} (${m.role})`).join(', ')],
  ]))

  const scheduleHtml = section('Custody schedule',
    schedule
      ? kv([
          ['Pattern', (schedule as any).pattern_type],
          ['Start date', fmtDate((schedule as any).start_date)],
          ['Starting parent', (schedule as any).starting_parent],
          ['Last updated', fmtDate((schedule as any).updated_at)],
        ])
      : '<p class="empty">No schedule set.</p>'
  ) + section('Schedule changes', table(
    ['Dates', 'Assigned to', 'Status', 'Note', 'Requested'],
    (scheduleChanges ?? []).map((c: any) => [
      esc(c.start_date + (c.end_date && c.end_date !== c.start_date ? ' → ' + c.end_date : '')),
      esc(c.assigned_to === 'parent_a' ? memberMap['parent_a'] : memberMap['parent_b']),
      esc(c.status),
      esc(c.note),
      esc(fmtDate(c.created_at)),
    ])
  ))

  const eventsHtml = section(`Calendar events (${events?.length ?? 0})`, table(
    ['Date', 'Title', 'Time', 'Notes', 'Source'],
    (events ?? []).map((e: any) => [
      esc(e.event_date + (e.end_date && e.end_date !== e.event_date ? ' → ' + e.end_date : '')),
      esc(e.title),
      esc(e.event_time),
      esc(e.notes),
      esc(e.source),
    ])
  ))

  const noticesHtml = section(`Notice board (${notices?.length ?? 0})`, table(
    ['Date', 'Tag', 'Content'],
    (notices ?? []).map((p: any) => [
      esc(fmtDate(p.created_at)),
      esc(p.tag),
      `<span style="white-space:pre-wrap">${esc(p.content)}</span>`,
    ])
  ))

  const messagesHtml = section(`Messages (${messages?.length ?? 0})`, table(
    ['Date', 'Content'],
    (messages ?? []).map((m: any) => [
      esc(fmtDate(m.created_at)),
      `<span style="white-space:pre-wrap">${esc(m.content)}</span>`,
    ])
  ))

  const expensesHtml = section(`Expenses (${expenses?.length ?? 0})`, table(
    ['Date', 'Description', 'Amount', 'Paid by', 'Split', 'Settled'],
    (expenses ?? []).map((e: any) => [
      esc(fmtDate(e.created_at)),
      esc(e.description),
      e.amount != null ? `£${Number(e.amount).toFixed(2)}` : '—',
      esc(e.paid_by === 'parent_a' ? memberMap['parent_a'] : memberMap['parent_b']),
      e.split_pct != null ? `${e.split_pct}% / ${100 - e.split_pct}%` : '—',
      esc(e.settled ? 'Yes' : 'No'),
    ])
  ))

  // Group info bank by child then section
  const infoBySub: Record<string, Record<string, any>> = {}
  for (const row of infoBank ?? []) {
    const r = row as any
    if (!infoBySub[r.child_name]) infoBySub[r.child_name] = {}
    infoBySub[r.child_name][r.section] = r.data
  }
  let infoBankHtml = '<h2>Info Bank</h2>'
  for (const [name, sections] of Object.entries(infoBySub)) {
    infoBankHtml += `<h3>${esc(name)}</h3>`
    for (const [sec, data] of Object.entries(sections as Record<string, any>)) {
      infoBankHtml += `<p class="section-label">${esc(sec)}</p>`
      infoBankHtml += kv(Object.entries(data).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' '), v as string]))
    }
  }
  if (!Object.keys(infoBySub).length) infoBankHtml += '<p class="empty">No records.</p>'

  const vaultHtml = section(`Documents (${vaultDocs?.length ?? 0})`, table(
    ['Title', 'Category', 'File', 'Size', 'Uploaded'],
    (vaultDocs ?? []).map((d: any) => [
      esc(d.title),
      esc(d.category),
      esc(d.file_name),
      d.file_size ? `${Math.round(d.file_size / 1024)} KB` : '—',
      esc(fmtDate(d.created_at)),
    ])
  ))

  // ── Assemble full HTML document ────────────────────────────────────────────

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Canopy — My Data (${esc(member.display_name)})</title>
<style>
  body { font-family: Georgia, serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; font-size: 13px; }
  h1 { font-size: 22px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 36px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; font-weight: bold; margin: 16px 0 6px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 32px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { text-align: left; padding: 5px 8px; background: #f5f5f5; border: 1px solid #ddd; font-weight: bold; }
  td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  table.kv th { width: 200px; }
  .section-label { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #888; margin: 10px 0 4px; }
  .empty { color: #999; font-style: italic; }
  .disclaimer { margin-top: 48px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>Canopy — My Data</h1>
<p class="meta">Exported: ${now} &nbsp;|&nbsp; ${esc(member.display_name)} &nbsp;|&nbsp; ${esc(user.email)}</p>

${profileHtml}
${familyHtml}
${scheduleHtml}
${eventsHtml}
${noticesHtml}
${messagesHtml}
${expensesHtml}
${infoBankHtml}
${vaultHtml}

<p class="disclaimer">
This document was generated by Canopy in response to a data access request under UK GDPR Article 15.
It contains personal data held about the above user and their family account as at the date of export.
Document and file attachments stored in the vault are not included in this export.
</p>
</body></html>`

  return new Response(JSON.stringify({ ok: true, html }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
