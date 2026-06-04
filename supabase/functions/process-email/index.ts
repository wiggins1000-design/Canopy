// Canopy — Supabase Edge Function: process-email
//
// Receives inbound emails via Postmark webhook, analyses them with Claude Haiku,
// and creates calendar events / notice posts / saves documents automatically.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// 1. Buy a domain (e.g. canopy.app) and add it to Postmark as an inbound domain
// 2. Set a catch-all inbound route in Postmark pointing to this function's URL:
//    https://<project>.supabase.co/functions/v1/process-email
// 3. Set these secrets in Supabase dashboard → Edge Functions → Secrets:
//
//   ANTHROPIC_API_KEY      = sk-ant-...  (from console.anthropic.com)
//   EMAIL_DOMAIN           = canopy.app  (your inbound domain)
//   EMAIL_WEBHOOK_TOKEN    = any-random-secret  (set same value in Postmark webhook settings)
//   SUPABASE_URL           = (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY = (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy process-email --no-verify-jwt --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

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

  // Temporary: log payload keys and body field previews to diagnose HTML email parsing
  console.log('Payload keys:', Object.keys(payload))
  console.log('TextBody preview:', String(payload.TextBody || payload.textBody || '').slice(0, 200))
  console.log('HtmlBody preview:', String(payload.HtmlBody || payload.htmlBody || payload.html_body || '').slice(0, 200))

  // ── Extract family from To: address ──────────────────────────────────────
  // e.g. "abc123def456@canopy.app" → email_key = "abc123def456"
  const toRaw: string = payload.To || payload.to || ''
  const toAddress = toRaw.match(/<([^>]+)>/)?.[1] ?? toRaw.trim()
  const emailKey = toAddress.split('@')[0].toLowerCase()

  if (!emailKey) {
    return new Response(JSON.stringify({ error: 'no to address' }), { status: 400, headers: CORS })
  }

  const { data: family } = await supabase
    .from('families')
    .select('id, name, config')
    .eq('email_key', emailKey)
    .single()

  if (!family) {
    console.log('No family found for email_key:', emailKey)
    return new Response(JSON.stringify({ skipped: 'unknown family' }), { status: 200, headers: CORS })
  }

  // Identify the sender — try to match the From address to a family member
  const fromRaw: string = payload.From || payload.from || ''
  const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw.trim()).toLowerCase()
  // Extract display name for external senders e.g. "St Mary's School <admin@school.com>" → "St Mary's School"
  const fromDisplayName = fromRaw.match(/^([^<]+)</) ? fromRaw.match(/^([^<]+)</)?.[1].trim() : fromEmail

  let authorId: string | null = null
  let isExternalSender = false
  if (fromEmail) {
    const { data: senderUserId } = await supabase.rpc('get_user_id_by_email', { p_email: fromEmail })
    if (senderUserId) {
      const { data: senderMember } = await supabase
        .from('family_members')
        .select('user_id')
        .eq('family_id', family.id)
        .eq('user_id', senderUserId)
        .single()
      if (senderMember) authorId = senderMember.user_id
    }
  }

  // Secondary check — look up additional forwarding emails only if primary didn't match
  if (!authorId && fromEmail) {
    const { data: additionalEmail } = await supabase
      .from('member_additional_emails')
      .select('user_id')
      .eq('email', fromEmail)
      .single()
    if (additionalEmail) {
      const { data: senderMember } = await supabase
        .from('family_members')
        .select('user_id')
        .eq('family_id', family.id)
        .eq('user_id', additionalEmail.user_id)
        .single()
      if (senderMember) authorId = senderMember.user_id
    }
  }

  // Final fallback — external email (e.g. school newsletter), no family member identified
  if (!authorId) {
    isExternalSender = true
    // authorId stays null — post will show as "External" in the UI
  }

  // ── Fetch existing events for duplicate detection ─────────────────────────
  // Look back 14 days so we catch recently-added events that might be duplicated
  const lookbackDate = new Date()
  lookbackDate.setDate(lookbackDate.getDate() - 14)
  const { data: existingEvents } = await supabase
    .from('family_events')
    .select('id, title, event_date, end_date, event_time, notes')
    .eq('family_id', family.id)
    .gte('event_date', lookbackDate.toISOString().split('T')[0])
    .order('event_date', { ascending: true })
    .limit(100)

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

  const subject: string    = payload.Subject || '(no subject)'
  const rawText: string    = payload.TextBody || payload.StrippedTextReply || ''
  const rawHtml: string    = payload.HtmlBody || payload.html_body || ''
  const attachments: any[] = payload.Attachments || []

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

  console.log(`URLs found in email body: ${urls.length}`, urls)

  for (const url of urls) {
    try {
      const isSway = /sway\.(cloud\.microsoft|office\.com)\//i.test(url)
      console.log(`Fetching URL (isSway=${isSway}): ${url}`)
      const fetchUrl = isSway ? `https://r.jina.ai/${url}` : url
      const res = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Canopy-EmailBot/1.0' },
        signal: AbortSignal.timeout(isSway ? 20000 : 5000),
      })
      console.log(`URL fetch result: ${res.status} ${res.statusText}`)
      if (res.ok) {
        const raw = await res.text()
        const text = isSway
          ? raw.slice(0, 5000)
          : raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000)
        console.log(`Content fetched (${text.length} chars): ${text.slice(0, 200)}`)
        linkContent += `\n\nPage content from ${url}:\n${text}`
      }
    } catch (e) {
      console.error(`Failed to fetch URL ${url}:`, e)
    }
  }

  // ── Call Claude Haiku ─────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]

  const familyChildren: any[] = family.config?.children ?? []
  const childrenContext = familyChildren.length > 0
    ? '\nChildren in this family:\n' + familyChildren
        .filter((c: any) => c.name)
        .map((c: any) => {
          const parts = [c.name]
          if (c.year_group) parts.push(c.year_group)
          if (c.class_name) parts.push(`${c.class_name} class`)
          return `- ${parts.join(', ')}`
        })
        .join('\n')
    : ''

  const prompt = `You are a calendar assistant for Canopy, a co-parenting app.

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
- Extract EVERY date mentioned (school events, appointments, trips, deadlines)
- Use the current year if no year is given
- If a date range is mentioned create one event with start + end_date
- If the email mentions a specific year group or class that matches one of the children above, include the child's name in the event title (e.g. "Lily — Sports Day" instead of "Year 4 Sports Day")
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
      max_tokens: 2048,
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
    const match = aiText.match(/\{[\s\S]*\}/)
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
          const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${ev.end_date}` : ''
          updatedEventLines.push(`• ${ev.title} — ${ev.date}${end}${time}`)
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
        const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${ev.end_date}` : ''
        newEventLines.push(`• ${ev.title} — ${ev.date}${end}${time}`)
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
    const senderLine = isExternalSender ? `From: ${fromDisplayName ?? fromEmail}\n` : ''
    const content = `${senderLine}${parts.join('\n\n')}\n\n_From email: "${subject}"_`

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
      p_content:   `${isExternalSender ? `From: ${fromDisplayName ?? fromEmail}\n` : ''}${parsed.notice_post}\n\n_From email: "${subject}"_`,
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
