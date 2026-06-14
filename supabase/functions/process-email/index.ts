// Canopy — Supabase Edge Function: process-email
//
// Receives inbound emails via Postmark webhook, analyses them with Claude Haiku,
// and creates calendar events / notice posts / saves documents automatically.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// 1. Configure MX record for canopy-app.app to point to Postmark inbound servers
// 2. In Postmark, set inbound webhook URL → this function:
//    https://<project>.supabase.co/functions/v1/process-email
// 3. Set these secrets in Supabase dashboard → Edge Functions → Secrets:
//
//   ANTHROPIC_API_KEY      = sk-ant-...  (from console.anthropic.com)
//   EMAIL_WEBHOOK_TOKEN    = any-random-secret  (set same value in Postmark webhook settings)
//   SUPABASE_URL           = (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY = (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy process-email --no-verify-jwt --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import PostalMime from 'https://esm.sh/postal-mime@2.2.8'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function isTermDateLike(title: string): boolean {
  return /half.?term|end of term|last day of term|first day of term|term\s+start|term\s+end|term\s+begin|school\s+holiday|school\s+break|school\s+clos|school\s+returns?|inset\s+day|christmas\s+holid|easter\s+holid|summer\s+holid|spring\s+holid|autumn\s+holid/i.test(title)
}

function deriveKeyStage(yearGroup: string | undefined): string | null {
  if (!yearGroup) return null
  const lower = yearGroup.toLowerCase().trim()
  if (/nursery|reception|eyfs|\bfs\b|\bfs1\b|\bfs2\b/.test(lower)) return 'EYFS'
  if (/sixth.?form|year\s*1[23]|y1[23]/.test(lower)) return 'KS5'
  const m = lower.match(/year\s*(\d+)|^y(\d+)$/)
  if (!m) return null
  const y = parseInt(m[1] ?? m[2])
  if (y <= 2) return 'KS1'
  if (y <= 6) return 'KS2'
  if (y <= 9) return 'KS3'
  if (y <= 11) return 'KS4'
  return 'KS5'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Verify shared webhook token (set in Postmark inbound webhook settings)
  const webhookToken = Deno.env.get('EMAIL_WEBHOOK_TOKEN')
  if (webhookToken) {
    const incoming = req.headers.get('x-webhook-token')
    if (incoming !== webhookToken) {
      return new Response('Unauthorized', { status: 401, headers: CORS })
    }
  }

  const payload = await req.json()

  // ── Identify family from sender (From: address) ───────────────────────────
  // familyfeed@canopy-app.app is a shared inbox — families are identified by
  // who forwards the email, not by a unique per-family address.
  // Only emails from registered addresses are processed; all others are dropped.
  const fromRaw: string = payload.From || payload.from || ''
  const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw.trim()).toLowerCase()

  if (!fromEmail) {
    return new Response(JSON.stringify({ error: 'no from address' }), { status: 400, headers: CORS })
  }

  let familyId: string | null = null
  let authorId: string | null = null

  // Check primary auth email
  const { data: senderUserId } = await supabase.rpc('get_user_id_by_email', { p_email: fromEmail })
  if (senderUserId) {
    const { data: senderMember } = await supabase
      .from('family_members')
      .select('family_id, user_id')
      .eq('user_id', senderUserId)
      .single()
    if (senderMember) {
      familyId = senderMember.family_id
      authorId = senderMember.user_id
    }
  }

  // Check additional registered forwarding emails
  if (!familyId) {
    const { data: additionalEmail } = await supabase
      .from('member_additional_emails')
      .select('user_id')
      .eq('email', fromEmail)
      .single()
    if (additionalEmail) {
      const { data: senderMember } = await supabase
        .from('family_members')
        .select('family_id, user_id')
        .eq('user_id', additionalEmail.user_id)
        .single()
      if (senderMember) {
        familyId = senderMember.family_id
        authorId = senderMember.user_id
      }
    }
  }

  if (!familyId) {
    console.log('Unrecognised sender — dropping email from:', fromEmail)
    return new Response(JSON.stringify({ skipped: 'unrecognised sender' }), { status: 200, headers: CORS })
  }

  const { data: family, error: familyErr } = await supabase
    .from('families')
    .select('id, config')
    .eq('id', familyId)
    .single()
  if (familyErr) console.error('Family lookup error:', familyErr.message)

  if (!family) {
    return new Response(JSON.stringify({ skipped: 'family not found' }), { status: 200, headers: CORS })
  }

  // ── Fetch existing events for duplicate detection ─────────────────────────
  // Look back 14 days so we catch recently-added events that might be duplicated
  const lookbackDate = new Date()
  lookbackDate.setDate(lookbackDate.getDate() - 14)
  const [
    { data: existingEvents },
    { count: termDatesCount },
  ] = await Promise.all([
    supabase
      .from('family_events')
      .select('id, title, event_date, end_date, event_time, notes')
      .eq('family_id', family.id)
      .gte('event_date', lookbackDate.toISOString().split('T')[0])
      .order('event_date', { ascending: true })
      .limit(100),
    supabase
      .from('family_events')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', family.id)
      .eq('source', 'term_dates'),
  ])
  const hasTermDates = (termDatesCount ?? 0) > 0

  const existingEventsContext = existingEvents && existingEvents.length > 0
    ? '\n\nExisting calendar events (check for duplicates):\n' +
      existingEvents.map((e: any) => {
        const dateRange = e.end_date && e.end_date !== e.event_date
          ? `${e.event_date} to ${e.end_date}`
          : e.event_date
        const time = e.event_time ? ` at ${e.event_time}` : ''
        const notes = e.notes ? ` | notes: "${e.notes.slice(0, 80)}"` : ''
        return `- [id:${e.id}] ${e.title} — ${dateRange}${time}${notes}`
      }).join('\n')
    : ''

  const rawSubject: string  = payload.Subject || '(no subject)'
  // Strip Re:/Fwd:/Fw: chains (case-insensitive, repeated)
  const subject: string    = rawSubject.replace(/^(\s*(re|fwd?)\s*:\s*)*/i, '').trim() || rawSubject.trim()
  const attachments: any[] = payload.Attachments || []

  // Detect raw MIME emails (Cloudflare Worker forwards the full raw email as TextBody)
  let rawText: string = payload.TextBody || payload.StrippedTextReply || ''
  let rawHtml: string = payload.HtmlBody || payload.html_body || ''
  const looksLikeMime = /^(Received:|MIME-Version:|Content-Type:|Return-Path:)/m.test(rawText)
  if (looksLikeMime) {
    try {
      const parsed = await (PostalMime as any).parse(rawText)
      rawText = parsed.text || ''
      rawHtml = parsed.html || ''
      console.log(`MIME parsed — text: ${rawText.length} chars, html: ${rawHtml.length} chars`)
    } catch (e) {
      console.error('MIME parse error:', e)
    }
  }

  // Strip base64 blobs and truncate to keep well within Claude's token limit
  // Fall back to stripped HTML if no plain-text body
  const rawBody = rawText || rawHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const textBody = rawBody
    .replace(/base64,[A-Za-z0-9+/=\s]{100,}/g, '[attachment removed]')
    .replace(/Content-Transfer-Encoding: base64[\s\S]{0,50000}/gi, '[encoded content removed]')
    .slice(0, 12000)

  // ── Save document attachments to storage ─────────────────────────────────
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  let docsSaved = 0

  for (const att of attachments) {
    if (!att.Content || !att.Name) continue
    const isImage = IMAGE_TYPES.includes(att.ContentType)

    const bytes = Uint8Array.from(atob(att.Content), (c) => c.charCodeAt(0))
    const ext   = att.Name.split('.').pop()
    const path  = `${family.id}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('notice-attachments')
      .upload(path, bytes, { contentType: att.ContentType })

    if (!uploadErr) {
      await supabase.rpc('create_notice_post', {
        p_family_id: family.id,
        p_content:   `📎 File received by email: ${att.Name}\nSubject: "${subject}"`,
        p_image_url: isImage ? path : null,
        p_file_url:  isImage ? null : path,
        p_file_name: isImage ? null : att.Name,
        p_tag:       'notification',
        p_author_id: authorId,
      })
      docsSaved++
    }
  }

  // ── Fetch content from URLs in the email body ────────────────────────────
  // Sway pages are JS-rendered so we route them through Jina AI reader.
  // Extract URLs from plain text AND from HTML href attributes (Sway links
  // are often only in the HTML body, not the plain-text version).
  const textUrls  = textBody.match(/https?:\/\/[^\s)>\]"]+/g) ?? []
  const hrefUrls  = (rawHtml.match(/href="(https?:\/\/[^"]+)"/gi) ?? [])
    .map((m: string) => m.slice(6, -1))  // strip href=" and "
  const urls = [...new Set([...textUrls, ...hrefUrls])].slice(0, 2)
  let linkContent = ''


  for (const url of urls) {
    try {
      const isSway = /sway\.(cloud\.microsoft|office\.com)\//i.test(url)
      const fetchUrl = isSway ? `https://r.jina.ai/${url}` : url
      const res = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Canopy-EmailBot/1.0' },
        signal: AbortSignal.timeout(isSway ? 20000 : 5000),
      })
      if (res.ok) {
        const raw = await res.text()
        const text = isSway
          ? raw.slice(0, 12000)
          : raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000)
        linkContent += `\n\nPage content from ${url}:\n${text}`
      }
    } catch (e) {
      console.error(`Failed to fetch URL ${url}:`, e)
    }
  }

  // ── Call Claude Haiku ─────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]

  const familyChildren: any[] = (family.config?.children ?? []).filter((c: any) => c.name)

  // Fetch year group / class from info_bank school section (source of truth)
  const { data: schoolRows } = await supabase
    .from('info_bank')
    .select('child_name, data')
    .eq('family_id', family.id)
    .eq('section', 'school')

  const schoolByChild: Record<string, any> = {}
  for (const row of schoolRows ?? []) {
    schoolByChild[row.child_name] = row.data
  }

  const childrenContext = familyChildren.length > 0
    ? '\nChildren in this family:\n' + familyChildren
        .map((c: any) => {
          const school = schoolByChild[c.name] ?? {}
          const yearGroup = school.year_group || c.year_group
          const className = school.class_name || c.class_name
          const parts = [c.name]
          if (yearGroup) parts.push(yearGroup)
          const ks = deriveKeyStage(yearGroup)
          if (ks) parts.push(ks)
          if (className) parts.push(`${className} class`)
          return `- ${parts.join(', ')}`
        })
        .join('\n')
    : ''

  const prompt = `You are a calendar assistant for Canopy, a family organisation app.

Extract all calendar events, appointments and important dates from this email. Also decide if there is any important information that should be posted as a notice to both parents.

Subject: ${subject}
Body:
${textBody}${linkContent}

Today's date: ${today}${childrenContext}${existingEventsContext}

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "events": [
    {
      "title": "short clear title",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "time": "HH:MM or null",
      "notes": "any extra detail or null",
      "existing_id": "id of matching existing event, or null if this is new",
      "additional_notes": "any new information not already in the existing event's notes, or null"
    }
  ],
  "notice_post": "1-2 sentence summary for parents, or null if nothing important beyond the events"
}

Rules:
- ALWAYS include events that are whole-school, all-students, all-pupils, all-year-groups, or where no specific year group or class is mentioned — these apply to everyone
- ALWAYS include parent-facing events: coffee mornings, BBQs, open days, parents evening, school fairs, community events
- ALWAYS include events where parents are expected to attend or be aware of regardless of year group — sports days, class assemblies, performances, non-uniform days, charity days, school photos
- If an event explicitly names a specific year group, key stage (KS1/KS2/KS3/KS4/KS5/EYFS), or class, only include it if it matches one of the children's year group, key stage, or class name — skip it otherwise
- Use the current year if no year is given
- If a date range is mentioned create one event with start + end_date
- If the email mentions a specific year group, key stage, or class that matches one of the children above, include the child's name in the event title (e.g. "Lily — Sports Day" instead of "Year 4 Sports Day" or "KS2 Sports Day")
- Compare each extracted event against the existing calendar events list. If an event matches (same or very similar title on the same date), set existing_id to its id
- If it matches and the email adds genuinely new detail not already in the existing notes, set additional_notes to only that new information
- If it matches but adds nothing new, set existing_id and leave additional_notes as null (pure duplicate — will be silently skipped)
- notice_post should only be set if there is genuinely important information not captured by the events`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.text()
    console.error('Claude error:', err)
    return new Response(JSON.stringify({ error: 'AI error', detail: err }), { status: 502, headers: CORS })
  }

  const aiData  = await aiRes.json()
  const aiText: string = aiData.content?.[0]?.text ?? '{}'

  let parsed: { events?: any[], notice_post?: string | null } = {}
  try {
    // Strip markdown code fences if Claude wrapped the response
    const stripped = aiText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
  } catch {
    console.error('Failed to parse AI JSON:', aiText)
  }

  // ── Create / update / skip calendar events ───────────────────────────────
  const events = parsed.events ?? []
  let eventsCreated = 0
  let eventsUpdated = 0
  const newEventLines: string[]     = []
  const updatedEventLines: string[] = []

  const oneMonthAgo = new Date()
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
  const cutoff = oneMonthAgo.toISOString().split('T')[0]

  for (const ev of events) {
    if (!ev.title || !ev.date) continue
    if (ev.date < cutoff) continue  // skip events more than 1 month in the past
    if (hasTermDates && isTermDateLike(ev.title)) continue  // official term dates already loaded

    if (ev.existing_id) {
      // Duplicate detected by Claude
      if (ev.additional_notes) {
        // Has genuinely new information — append to existing event's notes
        const existing = (existingEvents ?? []).find((e: any) => e.id === ev.existing_id)
        const currentNotes = existing?.notes || ''
        const merged = currentNotes
          ? `${currentNotes}\n\n[Updated from "${subject}"]: ${ev.additional_notes}`
          : ev.additional_notes
        const { error } = await supabase
          .from('family_events')
          .update({ notes: merged })
          .eq('id', ev.existing_id)
        if (!error) {
          eventsUpdated++
          const time = ev.time ? ` at ${ev.time}` : ''
          const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${fmtDate(ev.end_date)}` : ''
          updatedEventLines.push(`• ${ev.title} — ${fmtDate(ev.date)}${end}${time}`)
        }
      }
      // else: pure duplicate — silently skip
    } else {
      // New event
      const { error } = await supabase.rpc('create_family_event', {
        p_family_id:      family.id,
        p_title:          ev.title,
        p_event_date:     ev.date,
        p_end_date:       ev.end_date || null,
        p_event_time:     ev.time     || null,
        p_notes:          ev.notes    || null,
        p_source:         'email_ai',
        p_source_subject: subject,
      })
      if (!error) {
        eventsCreated++
        const time = ev.time ? ` at ${ev.time}` : ''
        const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${fmtDate(ev.end_date)}` : ''
        newEventLines.push(`• ${ev.title} — ${fmtDate(ev.date)}${end}${time}`)
      }
    }
  }

  // ── Post a notice summarising what changed ────────────────────────────────
  let noticeCreated = false

  if (eventsCreated > 0 || eventsUpdated > 0) {
    const parts: string[] = []
    if (eventsCreated > 0) {
      parts.push(`📅 ${eventsCreated} new event${eventsCreated > 1 ? 's' : ''} added:\n${newEventLines.join('\n')}`)
    }
    if (eventsUpdated > 0) {
      parts.push(`✏️ ${eventsUpdated} existing event${eventsUpdated > 1 ? 's' : ''} updated with new details:\n${updatedEventLines.join('\n')}`)
    }
    const content = `${parts.join('\n\n')}\n\n_From email: "${subject}"_`

    const { error: noticeErr1 } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   content,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       null,
      p_author_id: authorId,
    })
    if (noticeErr1) console.error('Notice post error (events):', noticeErr1)
    else noticeCreated = true
  } else if (parsed.notice_post) {
    const { error: noticeErr2 } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   `${parsed.notice_post}\n\n_From email: "${subject}"_`,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       null,
      p_author_id: authorId,
    })
    if (noticeErr2) console.error('Notice post error (notice_post):', noticeErr2)
    else noticeCreated = true
  }

  console.log(`Processed email for family ${family.id}: ${eventsCreated} created, ${eventsUpdated} updated, ${docsSaved} docs, notice=${noticeCreated}`)

  return new Response(JSON.stringify({
    ok:              true,
    events_created:  eventsCreated,
    events_updated:  eventsUpdated,
    docs_saved:      docsSaved,
    notice_created:  noticeCreated,
  }), { status: 200, headers: CORS })
})
