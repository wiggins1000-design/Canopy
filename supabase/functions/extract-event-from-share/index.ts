// Canopy — Supabase Edge Function: extract-event-from-share
//
// Accepts content shared into Canopy via the OS share sheet (e.g. a WhatsApp
// message, photo, or forwarded PDF) and uses Claude to extract every dated
// event mentioned. Returns raw candidate events for the client to review and
// selectively add — unlike FamilyFeed's process-email, this does NOT create
// events itself, since the user is present and interactive (see
// AddFromSharePage.jsx).
//
// The extraction prompt below is modeled on process-email/index.ts's existing
// Stage-A extractionPrompt() (the same "extract every dated event, no
// relevance filtering" approach that already works well for FamilyFeed) but
// is NOT imported from it — process-email/index.ts has its own top-level
// Deno.serve() call, so importing anything from it would pull that whole
// handler into this function's bundle and run it as a side effect. Kept as an
// independent copy instead so process-email/index.ts stays completely
// untouched. Claude-calling logic is also independent (not reused) since
// process-email's hardcodes its usage-log category as 'familyfeed', which
// would misattribute this feature's spend in the /admin/claude-costs
// breakdown — this one logs 'event_extraction' instead.
//
// ── Request body ──────────────────────────────────────────────────────────────
//   { type: 'text',  text: string }
//   { type: 'pdf',   pdf_base64: string }
//   { type: 'image', image_base64: string, media_type: string }
//
// ── Response ─────────────────────────────────────────────────────────────────
//   { ok: true, events: RawEvent[] } | { ok: false, error: string }
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy extract-event-from-share --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logClaudeUsage } from '../_shared/claudeUsage.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RawEvent = {
  title:           string
  date:            string | null
  end_date:        string | null
  time:            string | null
  notes:           string | null
  applies_to:      string | null
  weekday:         string | null
  tagged_children: string[]
  is_duplicate?:   boolean
}

// Modeled on process-email/index.ts's Stage-A extractionPrompt() — see file
// header comment for why this is an independent copy, not an import. The
// tagged_children behavior specifically mirrors extract-event-from-image's
// known_children handling (see that function), since this is the same
// personal-content case (a family's own children being named), not
// FamilyFeed's whole-school-newsletter case.
// Deliberately has NO knowledge of the family's existing calendar events --
// see the Deno.serve handler for why. This call's only job is reading dates
// out of the shared content itself.
function extractionPrompt(dateFormatHint: string, isPdf: boolean, knownChildren: string[]): string {
  const today = new Date().toISOString().split('T')[0]
  const taggedChildrenLine = knownChildren.length
    ? `\nThe family's children are: ${knownChildren.join(', ')}. For each event, if it's clearly about one or more of them (e.g. "trip with Isabelle and Henry", "Henry's football"), include their exact name(s) from this list in tagged_children. Otherwise use an empty array — do not guess.`
    : ''
  return `You are extracting every dated event mentioned in a ${isPdf ? 'PDF document (it may be a native text document or a scanned/photographed page — read any dates visible anywhere, including tables, calendars and images, not just selectable text)' : 'shared message or image'}. Do not filter anything out for relevance — extract ALL events with a specific date, even ones that seem minor. Relevance filtering is handled by the user reviewing the results afterward.

Today's date: ${today}. ${dateFormatHint}${taggedChildrenLine}

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "events": [
    {
      "title": "short clear title — do not invent or assume a specific child's name",
      "date": "YYYY-MM-DD, or null if this specific event has no date clearly stated for it",
      "end_date": "YYYY-MM-DD or null",
      "time": "HH:MM or null",
      "notes": "any extra detail or null",
      "applies_to": "the specific year group, key stage, or class named for this event, or null if not mentioned",
      "weekday": "the day-of-week name exactly as written next to this date in the source (e.g. 'Thursday'), or null if no weekday is stated",
      "tagged_children": ["names from the known children list this event is about, or empty array"]
    }
  ]
}

Rules:
- Extract EVERY event mentioned, no matter how minor — including ones with no date stated
- Use the current year if no year is given
- If a date range is mentioned, create one event with start + end_date
- Dates must be YYYY-MM-DD
- IMPORTANT — most sources mix events that have a date with ones that don't (e.g. a flyer lists "Sports Day — 12 June" and, separately, "Non-uniform day" with no date printed anywhere on it). Every event does NOT need a date. If a specific event has no date clearly and individually stated for it, set "date" to null. This is the correct, expected output for that event — do NOT guess, estimate, or invent a plausible-sounding date
- IMPORTANT — if the source is a screenshot of a chat/conversation containing several separate messages (each with its own timestamp, e.g. "12:23", "Yesterday"), treat each message as fully independent. A date stated in one message must NEVER be applied to a different message about a different topic, even if they're visually close together, sent close in time, or appear in the same screenshot. Only use a date for a given event if that same message (or a message that is unambiguously a follow-up/clarification of it, e.g. "actually it's the 28th" replying to the same topic) states it
- If the source states a day-of-week next to the date, copy it into "weekday" exactly — do not calculate or infer it yourself
- Return ONLY valid JSON`
}

// Normalizes a title for comparison -- trim/lowercase/collapse whitespace.
// Deliberately NOT fuzzy matching: this only needs to catch the literal
// "same message shared again" case, and exact-after-normalization is far
// less risky than any similarity heuristic that could false-positive on two
// genuinely different events that happen to share wording.
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Runs entirely in code, not another Claude call -- see the Deno.serve
// handler's comment for why this replaced an LLM-judged is_duplicate field.
function markDuplicates(events: RawEvent[], existingEvents: { title: string; event_date: string }[]): RawEvent[] {
  const existingKeys = new Set(existingEvents.map((e) => `${normalizeTitle(e.title)}|${e.event_date}`))
  return events.map((ev) => ({
    ...ev,
    is_duplicate: ev.date != null && existingKeys.has(`${normalizeTitle(ev.title)}|${ev.date}`),
  }))
}

async function callClaudeForExtraction(content: string | any[], familyId: string | null): Promise<RawEvent[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  4096,
      // Default temperature (1.0) was letting the model guess/reuse a nearby
      // date for events with none stated rather than reliably following the
      // "set date to null" instruction below -- this is a structured
      // extraction task, not creative writing, so favor consistent rule-
      // following over variation.
      temperature: 0,
      messages:    [{ role: 'user', content }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('Extraction Claude error:', errText)
    throw new Error(`Claude API error (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  await logClaudeUsage(supabase, {
    category:     'event_extraction',
    edgeFunction: 'extract-event-from-share',
    model:        'claude-haiku-4-5-20251001',
    usage:        data.usage,
    familyId,
  })
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

function extractFromText(text: string, dateFormatHint: string, familyId: string | null, knownChildren: string[]): Promise<RawEvent[]> {
  return callClaudeForExtraction(`${extractionPrompt(dateFormatHint, false, knownChildren)}\n\nContent:\n${text}`, familyId)
}

function extractFromPdf(pdfBase64: string, dateFormatHint: string, familyId: string | null, knownChildren: string[]): Promise<RawEvent[]> {
  return callClaudeForExtraction([
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: extractionPrompt(dateFormatHint, true, knownChildren) },
  ], familyId)
}

function extractFromImage(imageBase64: string, mediaType: string, dateFormatHint: string, familyId: string | null, knownChildren: string[]): Promise<RawEvent[]> {
  return callClaudeForExtraction([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: extractionPrompt(dateFormatHint, false, knownChildren) },
  ], familyId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid body', { status: 400, headers: CORS }) }

  const { type } = body ?? {}
  if (type !== 'text' && type !== 'pdf' && type !== 'image') {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid type' }), { status: 400, headers: CORS })
  }

  // Family is always resolved server-side from the authenticated user, never
  // trusted from the request body — a client can't spoof another family's id.
  const { data: memberRow } = await supabase
    .from('family_members')
    .select('family_id, families(config)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!memberRow?.family_id) {
    return new Response(JSON.stringify({ ok: false, error: 'No family found for this account' }), { status: 404, headers: CORS })
  }

  const familyId = memberRow.family_id as string
  const config = (memberRow.families as any)?.config ?? {}
  const locale: string = config.locale ?? 'en-GB'
  const knownChildren: string[] = Array.isArray(config.children)
    ? config.children.map((c: any) => c?.name).filter((n: unknown): n is string => typeof n === 'string' && !!n.trim())
    : []

  // Same convention as process-email/index.ts's dateFormatHint — ambiguous
  // numeric dates read differently by region.
  const dateFormatHint = locale === 'en-US'
    ? 'Numeric dates in the source (e.g. "3/4/2026") follow US convention: MM/DD/YYYY.'
    : 'Numeric dates in the source (e.g. "3/4/2026") follow UK/AU/IE convention: DD/MM/YYYY.'

  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return new Response(JSON.stringify({ ok: false, error: 'AI not configured' }), { status: 500, headers: CORS })
  }

  let events: RawEvent[]
  try {
    if (type === 'text') {
      if (!body.text || typeof body.text !== 'string') {
        return new Response(JSON.stringify({ ok: false, error: 'Missing text' }), { status: 400, headers: CORS })
      }
      events = await extractFromText(body.text, dateFormatHint, familyId, knownChildren)
    } else if (type === 'pdf') {
      if (!body.pdf_base64 || typeof body.pdf_base64 !== 'string') {
        return new Response(JSON.stringify({ ok: false, error: 'Missing pdf_base64' }), { status: 400, headers: CORS })
      }
      events = await extractFromPdf(body.pdf_base64, dateFormatHint, familyId, knownChildren)
    } else {
      if (!body.image_base64 || !body.media_type) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing image_base64 or media_type' }), { status: 400, headers: CORS })
      }
      events = await extractFromImage(body.image_base64, body.media_type, dateFormatHint, familyId, knownChildren)
    }
  } catch (e) {
    console.error('extract-event-from-share error:', e)
    const message = e instanceof Error ? e.message : 'Extraction failed'
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 502, headers: CORS })
  }

  // Duplicate-detection runs AFTER extraction, as plain code, deliberately
  // decoupled from the Claude call that determines dates. An earlier version
  // handed the existing-events list to that same extraction call and asked
  // Claude to flag is_duplicate itself -- repeated real-device testing showed
  // it would sometimes copy a date straight off a matching existing title
  // instead of correctly leaving "date" null, which then made an undated
  // event look like a genuine duplicate. Keeping the existing-events list
  // out of the extraction prompt entirely makes that failure mode
  // structurally impossible, not just discouraged by instruction.
  const lookbackDate = new Date()
  lookbackDate.setDate(lookbackDate.getDate() - 14)
  const { data: existingEvents } = await supabase
    .from('family_events')
    .select('title, event_date')
    .eq('family_id', familyId)
    .gte('event_date', lookbackDate.toISOString().split('T')[0])
    .limit(100)

  const withDuplicates = markDuplicates(events, existingEvents ?? [])

  // Duplicates are kept in the response (with is_duplicate: true) rather than
  // dropped -- the client surfaces them as "already on your calendar" instead
  // of auto-adding or showing an editable card, so re-sharing the same
  // content isn't silent about what happened to it.
  return new Response(JSON.stringify({ ok: true, events: withDuplicates }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
