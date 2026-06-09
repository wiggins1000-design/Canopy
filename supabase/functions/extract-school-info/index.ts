// Canopy — extract-school-info Edge Function
//
// Given a school homepage URL, fetches and extracts:
//   school name, address, email, phone, headteacher, and term dates.
//
// Uses the canopy-reader Railway service for content fetching (handles
// JS-rendered pages, text PDFs, scanned PDFs via Vision, and images).
//
// ── Secrets required ──────────────────────────────────────────────────────────
//   READER_URL          e.g. https://canopy-reader.up.railway.app
//   READER_SECRET       shared secret for reader service auth
//   ANTHROPIC_API_KEY   for Claude extraction
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const READER_URL    = Deno.env.get('READER_URL') ?? ''
const READER_SECRET = Deno.env.get('READER_SECRET') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // JWT is verified automatically by Supabase before this function runs
  const { family_id, child_name, school_url } = await req.json()
  if (!school_url) {
    return new Response(JSON.stringify({ error: 'school_url required' }), { status: 400, headers: CORS })
  }

  const normalised = normaliseUrl(school_url)
  console.log(`extract-school-info: ${normalised}`)

  try {
    // ── Step 1: fetch homepage ────────────────────────────────────────────────
    const homepageText = await fetchViaReader(normalised)
    if (!homepageText) {
      return respond({ error: 'Could not fetch school homepage. Check the URL is correct.' })
    }

    // ── Step 2: check shared school_calendars cache ───────────────────────────
    const { data: cached } = await supabase
      .from('school_calendars')
      .select('*')
      .eq('homepage_url', normalised)
      .maybeSingle()

    const cacheAgeMs  = cached?.last_fetched_at
      ? Date.now() - new Date(cached.last_fetched_at).getTime()
      : Infinity
    const cacheValid  = cacheAgeMs < 30 * 24 * 60 * 60 * 1000   // 30 days

    let termDates: any[]     = cached?.term_dates ?? []
    let termDatesUrl: string = cached?.term_dates_url ?? normalised

    // ── Step 3: extract school info from homepage ─────────────────────────────
    const origin = (() => { try { return new URL(normalised).origin } catch { return normalised } })()
    let schoolInfo = await extractSchoolInfo(homepageText, normalised)
    console.log('Homepage extraction:', JSON.stringify(schoolInfo))

    // If contact details are missing, fetch the contact page in parallel with nothing else
    if (isMissingContactInfo(schoolInfo)) {
      schoolInfo = await enrichFromContactPage(schoolInfo, origin)
      console.log('After contact page enrichment:', JSON.stringify(schoolInfo))
    }

    if (schoolInfo.term_dates_url) termDatesUrl = schoolInfo.term_dates_url

    // ── Step 4: fetch + extract term dates (skip if cache is fresh) ───────────
    if (!cacheValid || termDates.length === 0) {
      console.log('Cache miss — fetching term dates')
      let termDatesText = ''

      if (termDatesUrl && termDatesUrl !== normalised) {
        termDatesText = await fetchViaReader(termDatesUrl) ?? ''
      }

      if (!termDatesText) {
        const found = await tryCommonTermDatePaths(normalised)
        if (found) { termDatesUrl = found.url; termDatesText = found.text }
      }

      if (termDatesText) {
        termDates = await extractTermDates(termDatesText)
        console.log(`Extracted ${termDates.length} term date events`)
      }
    } else {
      console.log(`Cache hit — reusing ${termDates.length} cached term dates`)
    }

    // ── Step 5: store school info in info_bank ────────────────────────────────
    if (family_id && child_name) {
      await storeSchoolInfo(family_id, child_name, schoolInfo)
    }

    // ── Step 6: store term dates ──────────────────────────────────────────────
    let eventsAdded = 0
    if (termDates.length > 0 && family_id) {
      eventsAdded = await storeTermDates(
        family_id,
        normalised,
        termDatesUrl,
        termDates,
        schoolInfo.school_name ?? cached?.school_name ?? null,
      )
    }

    return respond({
      ok:           true,
      school_info:  schoolInfo,
      term_dates:   termDates.length,
      events_added: eventsAdded,
    })
  } catch (e: any) {
    console.error('extract-school-info error:', e)
    return respond({ error: e?.message ?? 'Extraction failed' })
  }
})

// ── Reader service ────────────────────────────────────────────────────────────

async function fetchViaReader(url: string): Promise<string | null> {
  if (!READER_URL) {
    console.warn('READER_URL not set — using Jina')
    return fetchViaJina(url)
  }
  try {
    const res = await fetch(`${READER_URL}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${READER_SECRET}` },
      signal:  AbortSignal.timeout(40000),
    })
    if (!res.ok) {
      console.warn(`Reader returned ${res.status} for ${url} — falling back to Jina`)
      return fetchViaJina(url)
    }
    const text = await res.text()
    console.log(`Reader returned ${text.length} chars for ${url}`)
    return text || null
  } catch (e: any) {
    console.warn(`Reader fetch failed for ${url}: ${e?.message} — falling back to Jina`)
    return fetchViaJina(url)
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal:  AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    return (await res.text()).slice(0, 60000)
  } catch {
    return null
  }
}

// ── Claude extraction ─────────────────────────────────────────────────────────

interface SchoolInfo {
  school_name:    string | null
  school_address: string | null
  school_email:   string | null
  school_phone:   string | null
  head_teacher:   string | null
  school_hours:   string | null
  term_dates_url: string | null
  contact_url:    string | null
}

async function extractSchoolInfo(content: string, pageUrl: string): Promise<SchoolInfo> {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  return parseSchoolInfoJson(await callClaude(buildSchoolInfoPrompt(content, pageUrl, origin), 600))
}

function buildSchoolInfoPrompt(content: string, pageUrl: string, origin: string): string {
  return `Extract school information from this webpage content.

Base URL: ${pageUrl}

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name":    "full official school name or null",
  "school_address": "full postal address on one line or null",
  "school_email":   "main office email address or null",
  "school_phone":   "main office phone number or null",
  "head_teacher":   "headteacher / principal full name or null",
  "school_hours":   "school day hours e.g. '8:50am – 3:15pm' or null",
  "term_dates_url": "absolute URL of the term dates / school calendar page, or null",
  "contact_url":    "absolute URL of the contact / contact us page, or null"
}

Rules:
- For relative URLs (starting with /), prefix with ${origin}
- For term_dates_url: links mentioning 'term dates', 'term times', 'school calendar', 'holidays', 'academic year'
- For contact_url: links mentioning 'contact', 'contact us', 'get in touch', 'find us'
- If multiple emails/phones, prefer the main office one
- Return null for any field not found

Content:
${content.slice(0, 25000)}`
}

function parseSchoolInfoJson(res: string | null): SchoolInfo {
  if (!res) return emptySchoolInfo()
  try {
    const json = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return {
      school_name:    json.school_name    ?? null,
      school_address: json.school_address ?? null,
      school_email:   json.school_email   ?? null,
      school_phone:   json.school_phone   ?? null,
      head_teacher:   json.head_teacher   ?? null,
      school_hours:   json.school_hours   ?? null,
      term_dates_url: json.term_dates_url ?? null,
      contact_url:    json.contact_url    ?? null,
    }
  } catch {
    return emptySchoolInfo()
  }
}

function emptySchoolInfo(): SchoolInfo {
  return { school_name: null, school_address: null, school_email: null, school_phone: null, head_teacher: null, school_hours: null, term_dates_url: null, contact_url: null }
}

function isMissingContactInfo(info: SchoolInfo): boolean {
  return !info.school_address || !info.school_email || !info.school_phone
}

async function enrichFromContactPage(info: SchoolInfo, origin: string): Promise<SchoolInfo> {
  // Find the contact page URL — prefer Claude-identified one, then try common paths
  let contactUrl = info.contact_url
  if (!contactUrl) {
    for (const path of ['/contact', '/contact-us', '/contacts', '/about/contact', '/about-us/contact', '/school-information/contact']) {
      try {
        const r = await fetch(`${origin}${path}`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
        if (r.ok) { contactUrl = `${origin}${path}`; break }
      } catch { /* not found */ }
    }
  }
  if (!contactUrl) return info

  console.log(`Fetching contact page: ${contactUrl}`)
  const contactText = await fetchViaReader(contactUrl)
  if (!contactText) return info

  const contactInfo = parseSchoolInfoJson(
    await callClaude(buildSchoolInfoPrompt(contactText, contactUrl, origin), 600)
  )

  // Merge: fill in any blanks from the contact page
  return {
    school_name:    info.school_name    ?? contactInfo.school_name,
    school_address: info.school_address ?? contactInfo.school_address,
    school_email:   info.school_email   ?? contactInfo.school_email,
    school_phone:   info.school_phone   ?? contactInfo.school_phone,
    head_teacher:   info.head_teacher   ?? contactInfo.head_teacher,
    school_hours:   info.school_hours   ?? contactInfo.school_hours,
    term_dates_url: info.term_dates_url ?? contactInfo.term_dates_url,
    contact_url:    contactUrl,
  }
}

async function extractTermDates(content: string): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0]

  const res = await callClaude(
    `Extract all UK school term dates from this content. Today is ${today}.

Return ONLY valid JSON — no markdown, no explanation:
{
  "events": [
    {
      "title":    "e.g. Autumn Half Term / Christmas Holiday / Easter Holiday / Summer Holiday / INSET Day",
      "date":     "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null"
    }
  ]
}

Rules:
- Include ALL academic years shown (past, present, future)
- Include: half-term holidays, school holidays, INSET days, bank holidays that affect school
- Do NOT include term start or term end dates — only closed periods and INSET days
- For multi-day periods always set end_date
- Use academic year context to determine the correct year for each date

Content:
${content.slice(0, 30000)}`,
    2048
  )

  if (!res) return []
  try {
    const json = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return json.events ?? []
  } catch {
    return []
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function storeSchoolInfo(
  familyId:  string,
  childName: string,
  info:      SchoolInfo,
): Promise<void> {
  // Read current info_bank row
  const { data: row } = await supabase
    .from('info_bank')
    .select('data')
    .eq('family_id', familyId)
    .eq('child_name', childName)
    .eq('section', 'school')
    .maybeSingle()

  const current = (row?.data as Record<string, any>) ?? {}

  // Merge: only overwrite blank fields (don't overwrite manual entries)
  const updated: Record<string, any> = { ...current }
  const merge = (key: string, value: string | null) => {
    if (value && !current[key]) updated[key] = value
  }

  merge('school_name',    info.school_name)
  merge('school_address', info.school_address)
  merge('school_email',   info.school_email)
  merge('school_phone',   info.school_phone)
  merge('head_teacher',   info.head_teacher)
  merge('hours',          info.school_hours)

  updated.info_extracted_at = new Date().toISOString()

  await supabase
    .from('info_bank')
    .upsert(
      { family_id: familyId, child_name: childName, section: 'school', data: updated, updated_at: new Date().toISOString() },
      { onConflict: 'family_id,child_name,section' }
    )
}

async function storeTermDates(
  familyId:    string,
  homepageUrl: string,
  termDatesUrl: string,
  termDates:   any[],
  schoolName:  string | null,
): Promise<number> {
  // Upsert school_calendars cache
  const contentHash = await hashString(JSON.stringify(termDates))
  await supabase.from('school_calendars').upsert({
    homepage_url:    homepageUrl,
    term_dates_url:  termDatesUrl,
    school_name:     schoolName ?? undefined,
    term_dates:      termDates,
    content_hash:    contentHash,
    last_fetched_at: new Date().toISOString(),
  }, { onConflict: 'homepage_url' })

  // Get existing events to avoid duplicates
  const { data: existing } = await supabase
    .from('family_events')
    .select('title, event_date')
    .eq('family_id', familyId)
    .eq('source', 'term_dates')

  const existingKeys = new Set((existing ?? []).map((e: any) => `${e.title}||${e.event_date}`))

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 1)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  let added = 0
  for (const event of termDates) {
    if (!event.date || !event.title) continue
    if (event.date < cutoffStr) continue
    const key = `${event.title}||${event.date}`
    if (existingKeys.has(key)) continue

    const { error } = await supabase.rpc('create_family_event', {
      p_family_id:      familyId,
      p_title:          event.title,
      p_event_date:     event.date,
      p_end_date:       event.end_date ?? null,
      p_source:         'term_dates',
      p_source_subject: 'School term dates',
    })
    if (!error) added++
  }

  return added
}

// ── Common term date URL patterns ─────────────────────────────────────────────

async function tryCommonTermDatePaths(homepageUrl: string): Promise<{ url: string; text: string } | null> {
  const origin = (() => { try { return new URL(homepageUrl).origin } catch { return '' } })()
  if (!origin) return null

  const paths = [
    '/term-dates', '/term-dates/', '/term_dates', '/termdates',
    '/parents/term-dates', '/parents-and-carers/term-dates',
    '/key-information/term-dates', '/school-information/term-dates',
    '/about/term-dates', '/calendar', '/school-calendar', '/academic-calendar',
    '/parents/calendar', '/term-times', '/holiday-dates',
  ]

  for (const path of paths) {
    const url = `${origin}${path}`
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
      if (head.ok) {
        const text = await fetchViaReader(url)
        if (text && text.length > 200) return { url, text }
      }
    } catch { /* not found */ }
  }

  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callClaude(prompt: string, maxTokens: number): Promise<string | null> {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY not set'); return null }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) { console.error('Claude error:', await res.text()); return null }
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch (e: any) {
    console.error('callClaude error:', e?.message)
    return null
  }
}

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    // Strip to just the origin (homepage) — we want the root site
    return `${u.protocol}//${u.hostname}`
  } catch {
    return url
  }
}

async function hashString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function respond(body: object): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
