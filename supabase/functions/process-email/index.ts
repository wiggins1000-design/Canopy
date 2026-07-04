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
import JSZip from 'https://esm.sh/jszip@3.10.1'
import { sendDebugAlert } from '../_shared/debugAlert.ts'
import { getLocaleConfig, deriveKeyStage } from '../_shared/localeConfig.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function fmtDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-')
  return locale === 'en-US' ? `${m}/${d}/${y.slice(2)}` : `${d}/${m}/${y.slice(2)}`
}

function isTermDateLike(title: string, locale: string): boolean {
  return getLocaleConfig(locale).termDateRegex.test(title)
}

function parseFromEmail(fromRaw: string): string {
  return (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw.trim()).toLowerCase()
}

type RawEvent = {
  title:      string
  date:       string
  end_date:   string | null
  time:       string | null
  notes:      string | null
  applies_to: string | null
}

async function sha256Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── FamilyFeed content-extraction cache ─────────────────────────────────────
// Many families forward identical content (a school-wide newsletter, the same
// PDF, the same Sway link). Extracting raw dated events from a document is the
// expensive step; deciding which of those events matter to one family is cheap.
// This caches the expensive step by content hash so a second family forwarding
// the same content skips straight to the cheap per-family step.
async function getCachedRawEvents(hash: string): Promise<RawEvent[] | null> {
  const { data } = await supabase
    .from('familyfeed_content_cache')
    .select('id, raw_events, hit_count')
    .eq('content_hash', hash)
    .maybeSingle()
  if (!data) return null
  await supabase.from('familyfeed_content_cache')
    .update({ hit_count: (data.hit_count ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq('id', data.id)
  return data.raw_events as RawEvent[]
}

async function cacheRawEvents(hash: string, sourceType: string, sourceLabel: string, events: RawEvent[]): Promise<void> {
  const { error } = await supabase.from('familyfeed_content_cache').insert({
    content_hash: hash,
    source_type:  sourceType,
    source_label: sourceLabel.slice(0, 500),
    raw_events:   events,
  })
  // 23505 = unique violation — another concurrent request cached the same content first, benign
  if (error && (error as any).code !== '23505') console.error('cacheRawEvents insert failed:', error.message)
}

async function getRawEventsCached(
  hash: string, sourceType: string, sourceLabel: string, extractFn: () => Promise<RawEvent[]>,
): Promise<RawEvent[]> {
  const cached = await getCachedRawEvents(hash)
  if (cached) {
    console.log(`Content cache hit — ${sourceType} ${sourceLabel}`)
    return cached
  }
  const events = await extractFn()
  await cacheRawEvents(hash, sourceType, sourceLabel, events)
  return events
}

// Stage A extraction — deliberately family-agnostic (no children/existing-events
// context) so the result is safe to cache and reuse across any family that
// forwards this exact content. Extracts everything, unfiltered; per-family
// relevance filtering happens in Stage B.
function extractionPrompt(dateFormatHint: string, isPdf: boolean): string {
  const today = new Date().toISOString().split('T')[0]
  return `You are extracting every dated event mentioned in a school ${isPdf ? 'PDF document (it may be a native text document or a scanned/photographed page — read any dates visible anywhere, including tables, calendars and images, not just selectable text)' : 'communication'}. Do not filter anything out for relevance — extract ALL events with a specific date, even ones that seem to apply to only one year group, class, or a small group of students. Relevance filtering happens in a separate step later.

Today's date: ${today}. ${dateFormatHint}

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "events": [
    {
      "title": "short clear title — do not invent or assume a specific child's name",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "time": "HH:MM or null",
      "notes": "any extra detail or null",
      "applies_to": "the specific year group, key stage, or class named for this event (e.g. 'Year 6', 'KS2', 'Reception'), or null if it applies to the whole school / no group is mentioned"
    }
  ]
}

Rules:
- Extract EVERY event with a specific date, no matter how minor
- Use the current year if no year is given
- If a date range is mentioned, create one event with start + end_date
- Dates must be YYYY-MM-DD
- Return ONLY valid JSON`
}

async function callExtractionClaude(content: string | any[]): Promise<RawEvent[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages:   [{ role: 'user', content }],
    }),
  })
  if (!res.ok) { console.error('Extraction Claude error:', await res.text()); return [] }
  const data = await res.json()
  const text: string = data.content?.[0]?.text ?? '{}'
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const match = stripped.match(/\{[\s\S]*\}/)
    return match ? (JSON.parse(match[0]).events ?? []) : []
  } catch (e) {
    console.error('Extraction parse error:', e)
    return []
  }
}

async function extractRawEventsFromText(content: string, dateFormatHint: string): Promise<RawEvent[]> {
  return callExtractionClaude(`${extractionPrompt(dateFormatHint, false)}\n\nContent:\n${content}`)
}

async function extractRawEventsFromPdf(pdfBase64: string, dateFormatHint: string): Promise<RawEvent[]> {
  return callExtractionClaude([
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: extractionPrompt(dateFormatHint, true) },
  ])
}

// Fetches a linked page's text content, with a retry for JS-rendered newsletter pages
// (Sway/Smore/Peachjar via Jina) if the result looks suspiciously thin. Found via a real
// incident 2026-07-04: a Sway page that fetched fine moments later returned a near-empty
// render on the actual run, and Stage A silently produced one fake placeholder event
// instead of ~13 real ones — likely a stale/incomplete cached response from Jina for a
// URL fetched again shortly after a previous request. X-No-Cache forces a fresh render.
async function fetchPageTextWithSanityRetry(url: string, isJs: boolean): Promise<string | null> {
  const attempt = async (noCache: boolean): Promise<string | null> => {
    const fetchUrl = isJs ? `https://r.jina.ai/${url}` : url
    const headers: Record<string, string> = { 'User-Agent': 'Canopy-EmailBot/1.0' }
    if (isJs && noCache) headers['X-No-Cache'] = 'true'
    const res = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(isJs ? 20000 : 8000) })
    if (!res.ok) return null
    const raw = await res.text()
    // Real newsletters can be long — a real Reddam House weekly newsletter tested at
    // 54K+ chars, so Haiku's context window has ample room for a much larger cap than
    // the original 12K.
    return isJs
      ? raw.slice(0, 40000)
      : raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 30000)
  }

  let text = await attempt(false)
  if (isJs && (!text || text.trim().length < 3000)) {
    console.log(`Suspiciously thin content (${text?.length ?? 0} chars) for ${url}, retrying with X-No-Cache`)
    const retryText = await attempt(true)
    if (retryText && retryText.trim().length > (text?.trim().length ?? 0)) text = retryText
  }
  return text
}

// ── Admin diagnostics — logs every processed email to email_processing_log so
// FamilyFeed health can be monitored from /admin/familyfeed, the same way
// check-term-dates is monitored via school_calendars' scrape diagnostics.
async function logEmailProcessing(opts: {
  familyId:       string | null
  fromEmail:      string
  subject:        string
  status:         'success' | 'error' | 'skipped_consent' | 'skipped_unrecognised'
  eventsCreated?: number
  eventsUpdated?: number
  eventsSkipped?: number
  candidateEventsCount?: number
  docsSaved?:     number
  noticeCreated?: boolean
  errorStage?:    string
  errorMessage?:  string
}): Promise<void> {
  try {
    const diagnosis = opts.status === 'error'
      ? await generateEmailDiagnosis(opts.errorStage, opts.errorMessage, opts.subject).catch(() => null)
      : null

    const { error } = await supabase.from('email_processing_log').insert({
      family_id:      opts.familyId,
      from_email:     opts.fromEmail,
      subject:        opts.subject,
      status:         opts.status,
      events_created: opts.eventsCreated ?? 0,
      candidate_events_count: opts.candidateEventsCount ?? 0,
      events_updated: opts.eventsUpdated ?? 0,
      events_skipped: opts.eventsSkipped ?? 0,
      docs_saved:     opts.docsSaved ?? 0,
      notice_created: opts.noticeCreated ?? false,
      error_stage:    opts.errorStage ?? null,
      error_message:  opts.errorMessage ?? null,
      diagnosis,
    })
    if (error) console.error('logEmailProcessing insert failed:', error.message)
  } catch (e) {
    console.error('logEmailProcessing threw:', e)
  }
}

// Short Claude-generated plain-English diagnosis for a failed email, mirroring
// check-term-dates' generateDiagnosis. Only the failure stage/message and the
// (low-sensitivity) subject line are sent — never email body/attachment content.
async function generateEmailDiagnosis(stage: string | undefined, message: string | undefined, subject: string): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey || !message) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{
          role: 'user',
          content: `You are analysing why Canopy's FamilyFeed email processor failed on one email.

Subject: ${subject}
Failure stage: ${stage ?? 'unknown'}
Error: ${message}

In 1-2 sentences explain the likely root cause and what a developer could try to fix it.`,
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  let rawPayload: unknown
  try {
    rawPayload = await req.clone().json()
  } catch { rawPayload = {} }

  try {
    return await handleRequest(req)
  } catch (err) {
    await sendDebugAlert({
      functionName: 'process-email',
      error: err,
      input: { payload: rawPayload },
    })
    const p = rawPayload as any
    await logEmailProcessing({
      familyId:     null,
      fromEmail:    parseFromEmail(p?.From || p?.from || ''),
      subject:      p?.Subject || '(no subject)',
      status:       'error',
      errorStage:   'uncaught_exception',
      errorMessage: err instanceof Error ? `${err.message}\n${err.stack ?? ''}`.slice(0, 1000) : String(err).slice(0, 1000),
    })
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: CORS })
  }
})

async function handleRequest(req: Request): Promise<Response> {
  // Verify shared webhook token — fail-closed: reject if token is not configured
  const webhookToken = Deno.env.get('EMAIL_WEBHOOK_TOKEN')
  if (!webhookToken) {
    console.error('EMAIL_WEBHOOK_TOKEN not set — rejecting request')
    return new Response('Service misconfigured', { status: 503, headers: CORS })
  }
  const incoming = req.headers.get('x-webhook-token')
  if (incoming !== webhookToken) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const payload = await req.json()

  const rawSubject: string = payload.Subject || '(no subject)'
  // Strip Re:/Fwd:/Fw: chains (case-insensitive, repeated)
  const subject: string    = rawSubject.replace(/^(\s*(re|fwd?)\s*:\s*)*/i, '').trim() || rawSubject.trim()

  // ── Identify family from sender (From: address) ───────────────────────────
  // familyfeed@canopy-app.app is a shared inbox — families are identified by
  // who forwards the email, not by a unique per-family address.
  // Only emails from registered addresses are processed; all others are dropped.
  const fromRaw: string = payload.From || payload.from || ''
  const fromEmail = parseFromEmail(fromRaw)

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
    await logEmailProcessing({ familyId: null, fromEmail, subject, status: 'skipped_unrecognised' })
    return new Response(JSON.stringify({ skipped: 'unrecognised sender' }), { status: 200, headers: CORS })
  }

  const { data: family, error: familyErr } = await supabase
    .from('families')
    .select('id, config')
    .eq('id', familyId)
    .single()
  if (familyErr) console.error('Family lookup error:', familyErr.message)

  if (!family) {
    await logEmailProcessing({
      familyId, fromEmail, subject, status: 'error',
      errorStage: 'family_lookup', errorMessage: familyErr?.message ?? 'family not found',
    })
    return new Response(JSON.stringify({ skipped: 'family not found' }), { status: 200, headers: CORS })
  }

  const locale: string = (family.config as any)?.locale ?? 'en-GB'

  // Ambiguous numeric dates (e.g. "3/4/2026") are read differently depending on region -
  // US convention is MM/DD, everywhere else here (UK/Ireland/Australia) is DD/MM. Needed
  // early since the (cacheable) extraction stage below uses it too.
  const dateFormatHint = locale === 'en-US'
    ? 'Numeric dates in the source (e.g. "3/4/2026") follow US convention: MM/DD/YYYY.'
    : 'Numeric dates in the source (e.g. "3/4/2026") follow UK/AU/IE convention: DD/MM/YYYY.'

  // ── Check FamilyFeed consent ───────────────────────────────────────────────
  // Each parent must individually consent to AI processing of email content.
  if (authorId) {
    const { data: memberRow } = await supabase
      .from('family_members')
      .select('consents')
      .eq('user_id', authorId)
      .eq('family_id', familyId)
      .single()
    const hasConsented = !!(memberRow?.consents as any)?.familyfeed_ai?.given
    if (!hasConsented) {
      await sendRejectionEmail({ to: fromEmail, originalSubject: subject })
        .catch((e) => console.error('Rejection email failed:', e))
      await logEmailProcessing({ familyId, fromEmail, subject, status: 'skipped_consent' })
      return new Response(JSON.stringify({ skipped: 'consent not given' }), { status: 200, headers: CORS })
    }
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
    .slice(0, 30000)

  // ── Save document attachments to storage, and extract readable content ────
  // School newsletters often arrive as PDF/Word attachments rather than inline text,
  // so events need to be extracted from attachment content, not just the email body.
  // Extraction is the expensive step (large document → Claude) and is cacheable by
  // content hash — many families forward the exact same attachment (a school-wide
  // newsletter), so a second family forwarding identical bytes reuses the first
  // family's extraction instead of paying for it again.
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const MAX_ATTACHMENT_PDF_BYTES = 8 * 1024 * 1024
  const MAX_PDF_SOURCES = 3
  let docsSaved = 0
  let pdfSourcesUsed = 0
  const candidateEvents: RawEvent[] = []

  for (const att of attachments) {
    if (!att.Content || !att.Name) continue
    const isImage = IMAGE_TYPES.includes(att.ContentType)
    const ext = (att.Name.split('.').pop() || '').toLowerCase()

    const bytes = Uint8Array.from(atob(att.Content), (c) => c.charCodeAt(0))
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

    const isPdf  = att.ContentType === 'application/pdf' || ext === 'pdf'
    const isDocx = att.ContentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx'
    const isDoc  = att.ContentType === 'application/msword' || ext === 'doc'
    const isHtml = att.ContentType === 'text/html' || ext === 'html' || ext === 'htm'

    if (isPdf) {
      if (pdfSourcesUsed >= MAX_PDF_SOURCES) {
        console.log(`Already processed ${MAX_PDF_SOURCES} PDF sources, skipping: ${att.Name}`)
      } else if (bytes.length > MAX_ATTACHMENT_PDF_BYTES) {
        console.log(`Attachment PDF too large (${bytes.length} bytes), skipping content extraction: ${att.Name}`)
      } else {
        pdfSourcesUsed++
        const hash = await sha256Hex(att.Content)
        const events = await getRawEventsCached(hash, 'pdf', att.Name, () => extractRawEventsFromPdf(att.Content, dateFormatHint))
        candidateEvents.push(...events)
      }
    } else if (isDocx) {
      const text = (await extractDocxText(att.Content)).slice(0, 20000)
      if (text) {
        const hash = await sha256Hex(text)
        const events = await getRawEventsCached(hash, 'docx', att.Name, () => extractRawEventsFromText(text, dateFormatHint))
        candidateEvents.push(...events)
      }
    } else if (isDoc) {
      const text = extractLegacyDocText(bytes).slice(0, 20000)
      if (text) {
        const hash = await sha256Hex(text)
        const events = await getRawEventsCached(hash, 'doc', att.Name, () => extractRawEventsFromText(text, dateFormatHint))
        candidateEvents.push(...events)
      }
    } else if (isHtml) {
      const text = new TextDecoder().decode(bytes).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000)
      if (text) {
        const hash = await sha256Hex(text)
        const events = await getRawEventsCached(hash, 'html', att.Name, () => extractRawEventsFromText(text, dateFormatHint))
        candidateEvents.push(...events)
      }
    }
  }

  // ── Fetch content from URLs in the email body ────────────────────────────
  // Some newsletter builders (Microsoft Sway, Smore — the latter very common with
  // US schools) render their pages client-side in JS, so a plain fetch returns an
  // near-empty shell; route those through Jina AI reader instead. Direct links to a
  // PDF (e.g. Peachjar-style flyer distribution, common in the US) must be handled
  // as a document, not fetched as text — text-decoding raw PDF bytes just produces
  // binary garbage.
  // Extract URLs from plain text AND from HTML href attributes (links used by JS
  // newsletter builders are often only in the HTML body, not the plain-text version).
  const textUrls  = textBody.match(/https?:\/\/[^\s)>\]"]+/g) ?? []
  const hrefUrls  = (rawHtml.match(/href="(https?:\/\/[^"]+)"/gi) ?? [])
    .map((m: string) => m.slice(6, -1))  // strip href=" and "
  const urls = [...new Set([...textUrls, ...hrefUrls])].slice(0, 2)
  const isJsRenderedNewsletter = (url: string) => /sway\.(cloud\.microsoft|office\.com)\/|smore\.com\/|peachjar\.com\//i.test(url)
  const isPdfLink = (url: string) => /\.pdf(\?|$)/i.test(url)

  for (const url of urls) {
    try {
      if (isPdfLink(url)) {
        if (pdfSourcesUsed >= MAX_PDF_SOURCES) continue
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Canopy-EmailBot/1.0' },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) continue
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength > MAX_ATTACHMENT_PDF_BYTES) { console.log(`Linked PDF too large (${buf.byteLength} bytes), skipping: ${url}`); continue }
        let binary = ''
        const chunkSize = 0x8000
        for (let i = 0; i < buf.length; i += chunkSize) binary += String.fromCharCode(...buf.subarray(i, i + chunkSize))
        const pdfBase64 = btoa(binary)
        pdfSourcesUsed++
        const hash = await sha256Hex(pdfBase64)
        const events = await getRawEventsCached(hash, 'pdf', url, () => extractRawEventsFromPdf(pdfBase64, dateFormatHint))
        candidateEvents.push(...events)
        continue
      }

      const isJs = isJsRenderedNewsletter(url)
      const text = await fetchPageTextWithSanityRetry(url, isJs)
      if (text && text.trim()) {
        const hash = await sha256Hex(text)
        const events = await getRawEventsCached(hash, isJs ? 'jsrendered_page' : 'plain_page', url, () => extractRawEventsFromText(text, dateFormatHint))
        if (events.length <= 1 && text.length > 5000) {
          console.log(`Suspiciously few events (${events.length}) extracted from ${text.length} chars at ${url} — content may have been thin/stale on fetch`)
        }
        candidateEvents.push(...events)
      }
    } catch (e) {
      console.error(`Failed to fetch URL ${url}:`, e)
    }
  }

  // ── Call Claude Haiku ─────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]

  const familyChildren: any[] = (family.config?.children ?? []).filter((c: any) => c.name)
  const allChildNames: string[] = familyChildren.map((c: any) => c.name)

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
          const ks = deriveKeyStage(yearGroup, locale)
          if (ks) parts.push(ks)
          if (className) parts.push(`${className} class`)
          return `- ${parts.join(', ')}`
        })
        .join('\n')
    : ''

  // Per-family choice (Settings → FamilyFeed → "Which events to add"): only events
  // matching one of the children (default), or every event found regardless of
  // year group/class match.
  const eventScope: 'relevant' | 'all' = (family.config as any)?.familyfeed_event_scope === 'all' ? 'all' : 'relevant'

  const yearGroupRule = eventScope === 'all'
    ? `- For each event (using the candidate list's "applies_to" field, or found directly in the body), tag the matching child if one applies — but include the event either way, even if no child matches. This family has chosen to see every event found, not just ones relevant to their children.`
    : `- FIRST check whether the event names ONE specific year group, key stage/grade band (as shown for the children above), or class — via the candidate event's "applies_to" field, or mentioned directly in the body (e.g. "Year 6 Residential", "Reception Sports Day", "KS2 Assembly", "3rd Grade Field Trip"). If it does, only include it when that year group/key stage/class matches one of the children above — skip it otherwise, even if it sounds important. This overrides every other rule below — a trip, residential, leavers' event, class assembly, performance, or coffee morning that is explicitly for one year group is not relevant to a family with no child in that year group
- Only treat an event as relevant to everyone when "applies_to" is null/whole-school, or it's genuinely all-students, all-pupils, all-year-groups — e.g. whole-school photos, a non-uniform day, flu vaccinations for all years, INSET/training/PD days, a whole-school fair or fete
- ALWAYS include parent-facing events that are not tied to one year group: general parents' evenings, open days, whole-school coffee mornings, school fairs, community events`

  const candidateEventsBlock = candidateEvents.length > 0
    ? `\n\nCandidate events found in attachments/linked pages (extracted separately from ${candidateEvents.length} source(s) — not yet filtered for relevance to this family, and the same event may appear more than once if mentioned in multiple sources):\n${JSON.stringify(candidateEvents, null, 2)}`
    : ''

  const prompt = `You are a calendar assistant for Canopy, a family organisation app.

Decide which calendar events, appointments and important dates from this email are relevant to this specific family, using the children listed below. Also decide if there is any important information that should be posted as a notice to both parents.

Subject: ${subject}
Email body:
${textBody}${candidateEventsBlock}

Today's date: ${today}. ${dateFormatHint}${childrenContext}${existingEventsContext}

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
      "additional_notes": "any new information not already in the existing event's notes, or null",
      "tagged_children": ["child name", ...]
    }
  ],
  "notice_post": "1-2 sentence summary for parents, or null if nothing important beyond the events"
}

Rules:
- Also read the email body itself for any dated events not already covered by the candidate events list (e.g. something mentioned only in the forwarding message itself)
- If the same event appears more than once in the candidate list (e.g. mentioned in both an attachment and a linked page), only include it once
${yearGroupRule}
- Use the current year if no year is given
- If a date range is mentioned create one event with start + end_date
- If the event matches one of the children's year group, key stage, or class, include the child's name in the event title (e.g. "Lily — Sports Day" instead of "Year 4 Sports Day" or "KS2 Sports Day")
- Compare each extracted event against the existing calendar events list. If an event matches (same or very similar title on the same date), set existing_id to its id
- If it matches and the email adds genuinely new detail not already in the existing notes, set additional_notes to only that new information
- If it matches but adds nothing new, set existing_id and leave additional_notes as null (pure duplicate — will be silently skipped)
- For tagged_children: use ALL children in the family for whole-school events or events with no year group mentioned. Use only the matching child/children for year/class-specific events. Use an empty array [] for parent-only events not tied to any child (parents evenings, coffee mornings, school fairs, etc.)
- notice_post should only be set if there is genuinely important information not captured by the events`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.text()
    console.error('Claude error:', err)
    await logEmailProcessing({
      familyId, fromEmail, subject, status: 'error',
      errorStage: 'claude_call', errorMessage: err.slice(0, 1000),
    })
    return new Response(JSON.stringify({ error: 'AI error', detail: err }), { status: 502, headers: CORS })
  }

  const aiData  = await aiRes.json()
  const aiText: string = aiData.content?.[0]?.text ?? '{}'

  let parsed: { events?: any[], notice_post?: string | null } = {}
  let jsonParseError: string | null = null
  try {
    // Strip markdown code fences if Claude wrapped the response
    const stripped = aiText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
    else jsonParseError = `No JSON object found in AI response: ${aiText.slice(0, 500)}`
  } catch (e: any) {
    console.error('Failed to parse AI JSON:', aiText)
    jsonParseError = `${e?.message ?? 'parse error'} — raw response: ${aiText.slice(0, 500)}`
  }

  // ── Create / update / skip calendar events ───────────────────────────────
  const events = parsed.events ?? []
  let eventsCreated = 0
  let eventsUpdated = 0
  let eventsSkipped = 0
  const newEventLines: string[]     = []
  const updatedEventLines: string[] = []

  const oneMonthAgo = new Date()
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
  const cutoff = oneMonthAgo.toISOString().split('T')[0]

  for (const ev of events) {
    if (!ev.title || !ev.date) continue
    if (ev.date < cutoff) continue  // skip events more than 1 month in the past
    if (hasTermDates && isTermDateLike(ev.title, locale)) continue  // official term dates already loaded

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
          const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${fmtDate(ev.end_date, locale)}` : ''
          updatedEventLines.push(`• ${ev.title} — ${fmtDate(ev.date, locale)}${end}${time}`)
        }
      } else {
        // Pure duplicate — already on the calendar, nothing to add
        eventsSkipped++
      }
    } else {
      // New event
      const taggedChildren = Array.isArray(ev.tagged_children)
        ? ev.tagged_children.filter((n: string) => allChildNames.includes(n))
        : []
      const { error } = await supabase.rpc('create_family_event', {
        p_family_id:       family.id,
        p_title:           ev.title,
        p_event_date:      ev.date,
        p_end_date:        ev.end_date || null,
        p_event_time:      ev.time     || null,
        p_notes:           ev.notes    || null,
        p_source:          'email_ai',
        p_source_subject:  subject,
        p_tagged_children: taggedChildren.length > 0 ? taggedChildren : null,
      })
      if (!error) {
        eventsCreated++
        const time = ev.time ? ` at ${ev.time}` : ''
        const end  = ev.end_date && ev.end_date !== ev.date ? ` – ${fmtDate(ev.end_date, locale)}` : ''
        newEventLines.push(`• ${ev.title} — ${fmtDate(ev.date, locale)}${end}${time}`)
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
    const content = `${parts.join('\n\n')}\n\nFrom email: "${subject}"`

    const { error: noticeErr1 } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   content,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       'notification',
      p_author_id: authorId,
    })
    if (noticeErr1) console.error('Notice post error (events):', noticeErr1)
    else noticeCreated = true
  } else if (parsed.notice_post) {
    const { error: noticeErr2 } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   `${parsed.notice_post}\n\nFrom email: "${subject}"`,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       null,
      p_author_id: authorId,
    })
    if (noticeErr2) console.error('Notice post error (notice_post):', noticeErr2)
    else noticeCreated = true
  }

  console.log(`Processed email for family ${family.id}: ${eventsCreated} created, ${eventsUpdated} updated, ${eventsSkipped} skipped, ${docsSaved} docs, notice=${noticeCreated}`)

  // Send feedback email to the person who forwarded the email
  await sendFeedbackEmail({
    to:               fromEmail,
    originalSubject:  subject,
    eventsCreated,
    newEventLines,
    eventsUpdated,
    updatedEventLines,
    eventsSkipped,
    docsSaved,
  }).catch((e) => console.error('Feedback email failed:', e))

  await logEmailProcessing({
    familyId, fromEmail, subject,
    status:         jsonParseError ? 'error' : 'success',
    errorStage:     jsonParseError ? 'json_parse' : undefined,
    errorMessage:   jsonParseError ?? undefined,
    eventsCreated, eventsUpdated, eventsSkipped, docsSaved, noticeCreated,
    candidateEventsCount: candidateEvents.length,
  })

  return new Response(JSON.stringify({
    ok:              true,
    events_created:  eventsCreated,
    events_updated:  eventsUpdated,
    events_skipped:  eventsSkipped,
    docs_saved:      docsSaved,
    notice_created:  noticeCreated,
  }), { status: 200, headers: CORS })
}

// ── Word (.docx) attachment text extraction ─────────────────────────────────
// .docx is a zip of XML parts — unzip and strip tags from the main document body.
async function extractDocxText(base64: string): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(base64, { base64: true })
    const xml = await zip.file('word/document.xml')?.async('string')
    if (!xml) return ''
    return xml
      .replace(/<\/w:p>/g, '\n')       // paragraph end -> newline, before tags are stripped
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .trim()
  } catch (e) {
    console.error('extractDocxText failed:', e)
    return ''
  }
}

// Legacy binary .doc has no lightweight parser available in Deno — best-effort
// "strings"-style extraction of printable text runs from the OLE compound file.
// Word stores paragraph text as contiguous ASCII/Latin-1 runs even without a full
// parse, so this recovers most readable content, just without structure/formatting.
function extractLegacyDocText(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
  const runs = raw.match(/[ -~]{4,}/g) ?? []
  return runs.join(' ').replace(/\s+/g, ' ').trim()
}

// ── Feedback email ─────────────────────────────────────────────────────────────

async function sendFeedbackEmail(opts: {
  to:               string
  originalSubject:  string
  eventsCreated:    number
  newEventLines:    string[]
  eventsUpdated:    number
  updatedEventLines: string[]
  eventsSkipped:    number
  docsSaved:        number
}): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return

  const { to, originalSubject, eventsCreated, newEventLines, eventsUpdated, updatedEventLines, eventsSkipped, docsSaved } = opts

  const hasActivity = eventsCreated > 0 || eventsUpdated > 0 || docsSaved > 0

  let summaryHtml = ''
  if (eventsCreated > 0) {
    summaryHtml += `
      <div style="margin-bottom:20px;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1b4332;">
          📅 ${eventsCreated} new event${eventsCreated > 1 ? 's' : ''} added to your calendar
        </p>
        <div style="background:#f4fbf4;border:1px solid #d8f3dc;border-radius:10px;padding:12px 16px;">
          ${newEventLines.map(l => `<p style="margin:4px 0;font-size:13px;color:#374151;">${l}</p>`).join('')}
        </div>
      </div>`
  }
  if (eventsUpdated > 0) {
    summaryHtml += `
      <div style="margin-bottom:20px;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1b4332;">
          ✏️ ${eventsUpdated} existing event${eventsUpdated > 1 ? 's' : ''} updated with new details
        </p>
        <div style="background:#f4fbf4;border:1px solid #d8f3dc;border-radius:10px;padding:12px 16px;">
          ${updatedEventLines.map(l => `<p style="margin:4px 0;font-size:13px;color:#374151;">${l}</p>`).join('')}
        </div>
      </div>`
  }
  if (docsSaved > 0) {
    summaryHtml += `
      <p style="margin:0 0 20px;font-size:14px;color:#374151;">
        📎 ${docsSaved} attachment${docsSaved > 1 ? 's' : ''} saved to your Notice Board.
      </p>`
  }
  if (eventsSkipped > 0) {
    summaryHtml += `
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">
        ${eventsSkipped} event${eventsSkipped > 1 ? 's were' : ' was'} already on your calendar — skipped.
      </p>`
  }
  if (!hasActivity) {
    summaryHtml = `
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
        No calendar events were found in this email. If you expected events to be extracted, check that the email contains clear dates.
      </p>`
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">

        <tr><td style="background:#ffffff;padding:24px 40px 16px;border-bottom:3px solid #1b4332;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111827;">FamilyFeed</p>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">Canopy · Share what matters.</p>
        </td></tr>

        <tr><td style="padding:28px 40px;">
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Your email:</p>
          <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#111827;">${originalSubject}</p>
          ${summaryHtml}
        </td></tr>

        <tr><td style="padding:16px 40px 24px;border-top:1px solid #d8f3dc;">
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
            Events and notices appear in your Canopy app. To stop receiving these emails, remove your forwarding address in Canopy Settings → FamilyFeed.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'FamilyFeed <familyfeed@canopy-app.app>',
      to:      [to],
      subject: `FamilyFeed processed: ${originalSubject}`,
      html,
    }),
  })
}

// ── Rejection email (consent not yet given) ────────────────────────────────────

async function sendRejectionEmail(opts: { to: string; originalSubject: string }): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return

  const { to, originalSubject } = opts

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">

        <tr><td style="background:#ffffff;padding:24px 40px 16px;border-bottom:3px solid #1b4332;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111827;">FamilyFeed</p>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">Canopy · Share what matters.</p>
        </td></tr>

        <tr><td style="padding:28px 40px;">
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Your email:</p>
          <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#111827;">${originalSubject}</p>

          <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
            This email wasn't processed because you haven't enabled FamilyFeed on your account yet. To start using FamilyFeed, open Canopy and go to <strong>Settings → FamilyFeed</strong>, then tap <em>"I understand — enable FamilyFeed"</em>.
          </p>

          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#92400e;">Why do we ask?</p>
            <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6;">
              FamilyFeed uses AI to read your emails and extract dates, events, and notices. Because emails can contain personal information, data protection law requires us to record your explicit agreement before processing them. This is a one-time step per account.
            </p>
          </div>

          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Good emails to forward</p>
          <ul style="margin:0 0 20px;padding-left:20px;">
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">School newsletters and term date notices</li>
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Medical appointment letters and reminders</li>
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Activity and club booking confirmations</li>
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Sports fixture lists and match schedules</li>
          </ul>

          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Please don't forward</p>
          <ul style="margin:0 0 20px;padding-left:20px;">
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Bank statements, invoices, or anything with account numbers — the content is sent to AI for processing</li>
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Solicitor or legal correspondence — use the Court Orders feature in Canopy instead</li>
            <li style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.5;">Emails that contain private information you wouldn't want the other parent to see — both parents will see what FamilyFeed extracts</li>
          </ul>

          <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
            Once you've enabled FamilyFeed, simply forward this email again and it will be processed automatically.
          </p>
        </td></tr>

        <tr><td style="padding:16px 40px 24px;border-top:1px solid #d8f3dc;">
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
            To stop receiving these emails, do not forward further emails to FamilyFeed, or remove your forwarding address in Canopy Settings → FamilyFeed.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'FamilyFeed <familyfeed@canopy-app.app>',
      to:      [to],
      subject: `FamilyFeed: action needed to process your email`,
      html,
    }),
  })
}
