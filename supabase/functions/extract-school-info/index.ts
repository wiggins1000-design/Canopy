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
import { sendDebugAlert } from '../_shared/debugAlert.ts'
import { getLocaleConfig, getLocaleFromUrl, getClosedDayPatterns, CLAUDE_EXTRACTION_PROMPTS } from '../_shared/localeConfig.ts'

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

const CLOSED_DAY_TITLE: Record<string, string> = {
  'en-GB': 'INSET Day',
  'en-US': 'Professional Development Day',
  'en-AU': 'Pupil-Free Day',
  'en-IE': 'In-Service Day',
}

const SCHOOL_HOLIDAY_TITLE: Record<string, string> = {
  'en-GB': 'School Holiday',
  'en-US': 'School Break',
  'en-AU': 'School Holiday',
  'en-IE': 'School Holiday',
}

async function getFamilyLocale(familyId: string | undefined, schoolUrl?: string): Promise<string> {
  if (schoolUrl) {
    const fromUrl = getLocaleFromUrl(schoolUrl)
    if (fromUrl) return fromUrl
  }
  if (familyId) {
    const { data } = await supabase
      .from('families')
      .select('config')
      .eq('id', familyId)
      .maybeSingle()
    const locale = (data?.config as any)?.locale
    if (locale) return locale
  }
  return 'en-GB'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.clone().json() } catch { /* ignore */ }

  try {
    return await handleRequest(req, body)
  } catch (err) {
    await sendDebugAlert({
      functionName: 'extract-school-info',
      error: err,
      input: { school_url: body.school_url, family_id: body.family_id, child_name: body.child_name },
    })
    return respond({ error: 'Internal server error' })
  }
})

async function handleRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  // JWT is verified automatically by Supabase before this function runs
  const { family_id, child_name, school_url, image_base64, image_media_type, images } = body as any
  if (!school_url && !image_base64 && !(images?.length)) {
    return new Response(JSON.stringify({ error: 'school_url, image_base64, or images required' }), { status: 400, headers: CORS })
  }

  // ── Multi-image mode — OCR all images, combine text, return dates for client review ──
  if (images && Array.isArray(images) && images.length > 0) {
    try {
      const locale = await getFamilyLocale(family_id, school_url)
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      const texts = await Promise.all(
        (images as any[]).map((img) => {
          const mt = (validTypes.includes(img.media_type) ? img.media_type : 'image/jpeg') as 'image/jpeg'|'image/png'|'image/gif'|'image/webp'
          return extractTextFromImage(img.base64 as string, mt)
        })
      )
      const validTexts = texts.filter((t): t is string => t !== null)
      if (validTexts.length === 0) {
        return respond({ error: 'Could not read text from any of the images. Please try clearer photos.' })
      }
      const combined = validTexts.join('\n\n---\n\n')
      let termDates = await extractTermDates(combined, 4096, locale)
      const insetInferred = inferInsetDays(combined, locale)
      const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
      for (const d of insetInferred) {
        if (d.date && !existingKeys.has(`${d.title}||${d.date}`)) termDates.push(d)
      }

      // Gap-fill holidays against BOTH what was just extracted and whatever this family
      // already has saved, so a holiday spanning two separate photo-upload sessions
      // (e.g. term-end in an earlier photo, term-start in a later one) is still caught.
      const existingSaved = await fetchExistingTermDates(family_id)
      const gapHolidays = inferHolidayGaps([...existingSaved, ...termDates], locale)
      const existingSavedKeys = new Set(existingSaved.map(e => `${e.title}||${e.date}`))
      const alreadyIncludedKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
      for (const g of gapHolidays) {
        const key = `${g.title}||${g.date}`
        if (!existingSavedKeys.has(key) && !alreadyIncludedKeys.has(key)) termDates.push(g)
      }

      termDates = deduplicateTermDates(termDates)
      console.log(`Multi-image: extracted ${termDates.length} term dates from ${validTexts.length} image${validTexts.length !== 1 ? 's' : ''}`)
      return respond({ ok: true, dates: termDates })
    } catch (e: any) {
      console.error('Multi-image error:', e)
      return respond({ error: e?.message ?? 'Image extraction failed' })
    }
  }

  // ── Single image upload mode ───────────────────────────────────────────────
  if (image_base64) {
    try {
      const locale = await getFamilyLocale(family_id, school_url)
      const mediaType = (['image/jpeg','image/png','image/gif','image/webp'].includes(image_media_type)
        ? image_media_type : 'image/jpeg') as 'image/jpeg'|'image/png'|'image/gif'|'image/webp'

      console.log(`Image upload mode — media type: ${mediaType}`)
      const imageText = await extractTextFromImage(image_base64, mediaType)
      if (!imageText) {
        return respond({ error: 'Could not read text from the image. Please try a clearer photo.' })
      }

      let termDates = await extractTermDates(imageText, 4096, locale)
      const insetInferred = inferInsetDays(imageText, locale)
      const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
      for (const d of insetInferred) {
        if (d.date && !existingKeys.has(`${d.title}||${d.date}`)) termDates.push(d)
      }

      const existingSaved = await fetchExistingTermDates(family_id)
      const gapHolidays = inferHolidayGaps([...existingSaved, ...termDates], locale)
      const existingSavedKeys = new Set(existingSaved.map(e => `${e.title}||${e.date}`))
      const alreadyIncludedKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
      for (const g of gapHolidays) {
        const key = `${g.title}||${g.date}`
        if (!existingSavedKeys.has(key) && !alreadyIncludedKeys.has(key)) termDates.push(g)
      }

      termDates = deduplicateTermDates(termDates)
      console.log(`Image upload: extracted ${termDates.length} term dates`)

      let eventsAdded = 0
      if (termDates.length > 0 && family_id) {
        const cacheKey = school_url ? normaliseUrl(school_url) : `family:${family_id}`
        eventsAdded = await addTermDateEvents(family_id, cacheKey, termDates)
        if (school_url) await cacheSchoolData(cacheKey, cacheKey, termDates, emptySchoolInfo())
      }

      return respond({ ok: true, school_info: emptySchoolInfo(), term_dates: termDates.length, events_added: eventsAdded })
    } catch (e: any) {
      console.error('Image upload error:', e)
      return respond({ error: e?.message ?? 'Image extraction failed' })
    }
  }

  // Cache key is always just the hostname
  const normalised = normaliseUrl(school_url)

  console.log(`extract-school-info: ${normalised}`)

  try {
    const locale = await getFamilyLocale(family_id, normalised)

    // ── Check cache for existing school info ──────────────────────────────────
    const { data: cached } = await supabase
      .from('school_calendars')
      .select('school_name, school_address, school_email, school_phone, head_teacher, school_hours, last_fetched_at')
      .eq('homepage_url', normalised)
      .maybeSingle()

    // ── Fetch homepage ────────────────────────────────────────────────────────
    const homepageText = await fetchViaReader(normalised)
    if (!homepageText) {
      return respond({ error: 'Could not fetch school homepage. Check the URL is correct.' })
    }
    if (isBotBlocked(homepageText)) {
      return respond({ error: 'This school\'s website is blocking automated access. Enter the school details manually.' })
    }

    // ── Extract school info ───────────────────────────────────────────────────
    const origin = (() => { try { return new URL(normalised).origin } catch { return normalised } })()
    let schoolInfo = await extractSchoolInfo(homepageText, normalised, locale)
    console.log('Homepage extraction:', JSON.stringify(schoolInfo))

    // Fill contact blanks from cache
    if (cached) {
      schoolInfo = {
        ...schoolInfo,
        school_address: schoolInfo.school_address ?? cached.school_address ?? null,
        school_email:   schoolInfo.school_email   ?? cached.school_email   ?? null,
        school_phone:   schoolInfo.school_phone   ?? cached.school_phone   ?? null,
        head_teacher:   schoolInfo.head_teacher   ?? cached.head_teacher   ?? null,
        school_hours:   schoolInfo.school_hours   ?? cached.school_hours   ?? null,
      }
    }

    // ── Enrich contact info if incomplete ────────────────────────────────────
    if (isMissingContactInfo(schoolInfo)) {
      schoolInfo = await enrichFromContactPage(schoolInfo, normalised, origin, locale)
      console.log('After contact enrichment:', JSON.stringify(schoolInfo))
    }

    // ── Store in info_bank ────────────────────────────────────────────────────
    if (family_id && child_name) {
      await storeSchoolInfo(family_id, child_name, schoolInfo)
    }

    // ── Cache school info (term dates are managed separately by check-term-dates) ──
    await supabase.from('school_calendars').upsert({
      homepage_url:    normalised,
      locale,
      school_name:     schoolInfo.school_name     ?? undefined,
      school_address:  schoolInfo.school_address  ?? undefined,
      school_email:    schoolInfo.school_email    ?? undefined,
      school_phone:    schoolInfo.school_phone    ?? undefined,
      head_teacher:    schoolInfo.head_teacher    ?? undefined,
      school_hours:    schoolInfo.school_hours    ?? undefined,
      last_fetched_at: new Date().toISOString(),
    }, { onConflict: 'homepage_url' })

    return respond({ ok: true, school_info: schoolInfo })
  } catch (e: any) {
    console.error('extract-school-info error:', e)
    return respond({ error: e?.message ?? 'Extraction failed' })
  }
}

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

// Plain HTTP fetch from edge function — different TLS fingerprint from Puppeteer,
// which bypasses Cloudflare's browser-fingerprinting checks on some sites.
async function fetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
      signal:   AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    if (!res.ok) { console.warn(`Direct fetch ${res.status} for ${url}`); return null }
    const html = await res.text()
    // Strip HTML tags to get readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return text.slice(0, 60000) || null
  } catch (e: any) {
    console.warn(`Direct fetch failed for ${url}: ${e?.message}`)
    return null
  }
}

async function extractTextFromImage(base64: string, mediaType: 'image/jpeg'|'image/png'|'image/gif'|'image/webp'): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null
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
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text',  text: 'Extract ALL text from this school term dates document or calendar. Preserve all dates, event names, and structure as clearly as possible. Return only the extracted text.' },
          ],
        }],
      }),
    })
    if (!res.ok) { console.error('Vision API error:', await res.text()); return null }
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch (e: any) {
    console.error('extractTextFromImage failed:', e?.message)
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

async function extractSchoolInfo(content: string, pageUrl: string, locale = 'en-GB'): Promise<SchoolInfo> {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  return parseSchoolInfoJson(await callClaude(buildSchoolInfoPrompt(content, pageUrl, origin, locale), 600))
}

function buildSchoolInfoPrompt(content: string, pageUrl: string, origin: string, locale = 'en-GB'): string {
  const headLabel = locale === 'en-GB'
    ? 'headteacher / principal full name'
    : 'principal full name'
  const termDatesHints = locale === 'en-US'
    ? "'academic calendar', 'school calendar', 'school year', 'important dates', 'calendar'"
    : locale === 'en-AU'
    ? "'term dates', 'school calendar', 'key dates', 'terms', 'calendar'"
    : "'term dates', 'term times', 'school calendar', 'holidays', 'academic year'"

  return `Extract school information from this webpage content.

Base URL: ${pageUrl}

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name":    "full official school name or null",
  "school_address": "full postal address on one line or null",
  "school_email":   "main office email address or null",
  "school_phone":   "main office phone number or null",
  "head_teacher":   "${headLabel} or null",
  "school_hours":   "school day hours e.g. '8:50am – 3:15pm' or null",
  "term_dates_url": "absolute URL of the term dates / school calendar page, or null",
  "contact_url":    "absolute URL of the contact / contact us page, or null"
}

Rules:
- For relative URLs (starting with /), prefix with ${origin}
- For term_dates_url: links mentioning ${termDatesHints}
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

// ── Deduplication ─────────────────────────────────────────────────────────────
// When Claude extracts the same date range twice with different titles
// (e.g. "Autumn Half Term" and "Summer Holiday" for the same October dates),
// keep only the entry with the most semantically specific title.
const _TITLE_PRIORITY: Record<string, number> = {
  'Autumn Half Term':  10,
  'Spring Half Term':  10,
  'Summer Half Term':  10,
  'Christmas Holiday': 10,
  'Easter Holiday':    10,
  'INSET Day':          8,
  'Summer Holiday':     3,
  'Bank Holiday':       3,
}

function deduplicateTermDates(dates: any[]): any[] {
  function priority(title: string): number {
    return _TITLE_PRIORITY[title] ?? 6
  }
  const byRange = new Map<string, any>()
  for (const d of dates) {
    const key = `${d.date}|${d.end_date ?? ''}`
    const existing = byRange.get(key)
    if (!existing || priority(d.title) > priority(existing.title)) {
      byRange.set(key, d)
    }
  }
  return [...byRange.values()]
}

// ── Shared date helpers for TypeScript inference ──────────────────────────────

const _MONTH_NUMS: Record<string, number> = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
}
const _MO_RE = 'january|february|march|april|may|june|july|august|september|october|november|december'

function _shiftDay(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// Extracts dates from a snippet where dates include the year ("3 September 2026",
// "1st and 2nd September 2026", "31st August & 1st Sep 2026").
function _datesFromSnippet(snippet: string): string[] {
  const dates = new Set<string>()
  // Multiple day numbers sharing a month+year: "1st and 2nd September 2026"
  const multiRe = new RegExp(
    `\\b(\\d{1,2}(?:st|nd|rd|th)?(?:\\s*[,&]\\s*(?:and\\s+)?\\d{1,2}(?:st|nd|rd|th)?)*)\\s+(${_MO_RE})\\s+(\\d{4})\\b`,
    'gi'
  )
  for (const m of snippet.matchAll(multiRe)) {
    const month = _MONTH_NUMS[m[2].toLowerCase()], year = parseInt(m[3])
    if (!month) continue
    for (const dm of m[1].matchAll(/\d{1,2}/g)) {
      const day = parseInt(dm[0])
      if (day >= 1 && day <= 31)
        dates.add(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`)
    }
  }
  // Simple full dates
  const simpleRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${_MO_RE})\\s+(\\d{4})\\b`, 'gi')
  for (const m of snippet.matchAll(simpleRe)) {
    const day = parseInt(m[1]), month = _MONTH_NUMS[m[2].toLowerCase()], year = parseInt(m[3])
    if (month && day >= 1 && day <= 31)
      dates.add(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`)
  }
  // Partial dates like "31st August" — infer year from the nearest full date in this snippet
  if (dates.size > 0) {
    const inferredYear = parseInt([...dates].sort().pop()!.split('-')[0])
    const partialRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${_MO_RE})\\b(?!\\s+\\d{4})`, 'gi')
    for (const m of snippet.matchAll(partialRe)) {
      const day = parseInt(m[1]), month = _MONTH_NUMS[m[2].toLowerCase()]
      if (month && day >= 1 && day <= 31)
        dates.add(`${inferredYear}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`)
    }
  }
  return [...dates].sort()
}

// Extracts dates from a snippet where dates may have NO year ("8th September"),
// using defaultYear from the enclosing section heading.
function _datesFromSnippetWithYear(snippet: string, defaultYear: number): string[] {
  const full = _datesFromSnippet(snippet)
  if (full.length > 0) return full   // full dates found — use them
  const dates = new Set<string>()
  const re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${_MO_RE})\\b`, 'gi')
  for (const m of snippet.matchAll(re)) {
    const day = parseInt(m[1]), month = _MONTH_NUMS[m[2].toLowerCase()]
    if (month && day >= 1 && day <= 31)
      dates.add(`${defaultYear}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`)
  }
  return [...dates].sort()
}

// Parse the text into term sections, each tagged with a year from headings like
// "Autumn Term 2026" or "Summer Term 2025-26". Returns lines grouped by section.
function _parseSections(text: string): Array<{term: string, year: number, lines: string[]}> {
  const sections: Array<{term: string, year: number, startIdx: number}> = []
  const headingRe = /\b(autumn|spring|summer)\s+term\s+(\d{4})\b/gi
  for (const m of text.matchAll(headingRe)) {
    sections.push({ term: m[1].toLowerCase(), year: parseInt(m[2]), startIdx: m.index! })
  }
  return sections.map((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1].startIdx : text.length
    const lines = text.slice(s.startIdx, end).split('\n').map(l => l.trim()).filter(Boolean)
    return { term: s.term, year: s.year, lines }
  })
}

// ── Generic holiday-gap inference ────────────────────────────────────────────
// Locale- and season-independent: any "school closes" event followed later by a
// "school reopens" event, with no already-labelled holiday covering that gap, is
// treated as an inferred school holiday - regardless of which term or time of
// year it falls in. Runs on structured {title, date, end_date} events (already
// extracted from photos/text by Claude), not on raw text, so it works the same
// way for a UK "END OF TERM" line, an Australian "Students Conclude - Term Two",
// or a US "Last Day of School" - only the closing/opening *wording* differs.
const _CLOSES_RE  = /\b(end|ends|ended|close|closes|closed|last\s+day|conclude|concludes|concluded|finish|finishes|breaks?\s+up)\b/i
const _OPENS_RE   = /\b(start|starts|begin|begins|open|opens|reopen|reopens|return|returns|resume|resumes|commence|commences|back\s+to\s+school|first\s+day)\b/i
const _HOLIDAY_RE = /\b(holiday|holidays|break|vacation)\b/i

type GapEvent = { title: string, date: string, end_date: string | null }

function _classifyForGap(e: GapEvent): 'closes' | 'opens' | 'holiday' | 'other' {
  const t = e.title.toLowerCase()
  if (e.end_date || _HOLIDAY_RE.test(t)) return 'holiday'
  if (_CLOSES_RE.test(t)) return 'closes'
  if (_OPENS_RE.test(t))  return 'opens'
  return 'other'
}

// `events` should include both newly-extracted dates AND anything already saved
// for this family, so a holiday spanning two separate photo-upload sessions
// (e.g. "term ends" in an earlier photo, "term begins" in a later one) is still
// caught. Returns only the newly-inferred gap holidays, not the input events.
function inferHolidayGaps(events: GapEvent[], locale = 'en-GB'): Array<{title: string, date: string, end_date: string}> {
  const holidayTitle = SCHOOL_HOLIDAY_TITLE[locale] ?? 'School Holiday'
  const sorted   = [...events].filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date))
  const closes   = sorted.filter(e => _classifyForGap(e) === 'closes')
  const opens    = sorted.filter(e => _classifyForGap(e) === 'opens')
  const holidays = sorted.filter(e => _classifyForGap(e) === 'holiday')

  const coveredByExisting = (start: string, end: string) =>
    holidays.some(h => h.date <= end && (h.end_date ?? h.date) >= start)

  const results: Array<{title: string, date: string, end_date: string}> = []
  const seen = new Set<string>()
  for (const c of closes) {
    const nextOpen = opens.filter(o => o.date > c.date).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (!nextOpen) continue
    const gapStart = _shiftDay(c.date, 1)
    const gapEnd   = _shiftDay(nextOpen.date, -1)
    if (gapEnd < gapStart) continue // adjacent days, no real gap
    if (coveredByExisting(gapStart, gapEnd)) continue
    const key = `${gapStart}|${gapEnd}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ title: holidayTitle, date: gapStart, end_date: gapEnd })
  }
  return results
}

async function fetchExistingTermDates(familyId: string | undefined): Promise<GapEvent[]> {
  if (!familyId) return []
  const { data } = await supabase
    .from('family_events')
    .select('title, event_date, end_date')
    .eq('family_id', familyId)
    .eq('source', 'term_dates')
  return (data ?? []).map((r: any) => ({ title: r.title as string, date: r.event_date as string, end_date: r.end_date as string | null }))
}

// Infer INSET / closure days — handles both "Staff Training Days: 1 Sep 2026"
// (full-date format) and "8th September - Staff Inset (school closed to students)"
// (no-year format with section heading context).
function inferInsetDays(allContent: string, locale = 'en-GB'): Array<{title: string, date: string, end_date: null}> {
  const text = allContent.replace(/\*\*/g, ' ')
  const seen = new Set<string>()
  const results: Array<{title: string, date: string, end_date: null}> = []
  const title = CLOSED_DAY_TITLE[locale] ?? 'INSET Day'
  const add = (date: string) => { if (!seen.has(date)) { seen.add(date); results.push({ title, date, end_date: null }) } }

  const patterns = getClosedDayPatterns(locale)

  // Full-date patterns (dates include year) — run all locale patterns against the full text
  for (const pat of patterns) {
    const fullPat = new RegExp(pat.source + '[^\\n]{0,300}', 'gi')
    for (const m of text.matchAll(fullPat)) _datesFromSnippet(m[0]).forEach(add)
  }

  // Section-based patterns — only reliable for UK/IE where term headings say "Autumn Term 2026"
  if (locale === 'en-GB' || locale === 'en-IE') {
    for (const section of _parseSections(text)) {
      for (const line of section.lines) {
        if (patterns.some(p => p.test(line))) {
          _datesFromSnippetWithYear(line, section.year).forEach(add)
        }
      }
    }
  }

  return results
}


function isBotBlocked(text: string): boolean {
  const lower = text.slice(0, 1000).toLowerCase()
  return lower.includes('just a moment') || lower.includes('captcha') || lower.includes('security verification') || lower.includes('verifying you are not a bot')
}

function isMissingContactInfo(info: SchoolInfo): boolean {
  return !info.school_address || !info.school_email || !info.school_phone
}

async function findContactUrl(homepageUrl: string, origin: string, claudeContactUrl: string | null): Promise<string | null> {
  // 1. Use Claude-identified URL if available
  if (claudeContactUrl) return claudeContactUrl

  // 2. Use Jina's link summary to get all navigation links from the homepage
  try {
    const res = await fetch(`https://r.jina.ai/${homepageUrl}`, {
      headers: { Accept: 'text/plain', 'X-With-Links-Summary': 'all' },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const text = await res.text()
      // Extract links section (Jina appends "Links/Images found:" at the bottom)
      const linksSection = text.split(/links\/images found:/i)[1] ?? text
      const lines = linksSection.split('\n')
      const contactKeywords = /contact|find.us|get.in.touch|about.us|reach.us/i
      for (const line of lines) {
        const urlMatch = line.match(/https?:\/\/[^\s)"]+/)
        if (urlMatch && contactKeywords.test(line)) {
          console.log(`Found contact URL via Jina links: ${urlMatch[0]}`)
          return urlMatch[0]
        }
      }
    }
  } catch (e: any) {
    console.warn('Jina link summary failed:', e?.message)
  }

  // 3. Try common path patterns in parallel
  const pathChecks = await Promise.all(
    ['/contact', '/contact-us', '/contacts', '/about/contact', '/about-us/contact', '/school-information/contact', '/key-information/contact'].map(async (path) => {
      try {
        const r = await fetch(`${origin}${path}`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
        return r.ok ? `${origin}${path}` : null
      } catch { return null }
    })
  )
  return pathChecks.find(Boolean) ?? null
}

async function enrichFromContactPage(info: SchoolInfo, homepageUrl: string, origin: string, locale = 'en-GB'): Promise<SchoolInfo> {
  const contactUrl = await findContactUrl(homepageUrl, origin, info.contact_url)
  if (!contactUrl) {
    console.log('No contact page found')
    return info
  }

  console.log(`Fetching contact page: ${contactUrl}`)
  const contactText = await fetchViaReader(contactUrl)
  if (!contactText) return info

  const contactInfo = parseSchoolInfoJson(
    await callClaude(buildSchoolInfoPrompt(contactText, contactUrl, origin, locale), 600)
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

async function enrichFromSchoolDayPage(info: SchoolInfo, origin: string): Promise<SchoolInfo> {
  const paths = [
    '/school-day', '/school-day/', '/school-times', '/school-hours',
    '/parents/school-day', '/parents/school-times', '/parents-and-carers/school-day',
    '/key-information/school-day', '/key-information/school-times',
    '/school-information/school-day', '/about/school-day',
    '/our-school/school-day', '/school-life/school-day',
  ]

  const checks = await Promise.all(
    paths.map(async (path) => {
      try {
        const url = `${origin}${path}`
        const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
        return r.ok ? url : null
      } catch { return null }
    })
  )
  const url = checks.find(Boolean)
  if (!url) return info

  const text = await fetchViaReader(url)
  if (!text || text.length < 100) return info

  console.log(`Fetching school day page: ${url}`)
  const extracted = parseSchoolInfoJson(await callClaude(buildSchoolInfoPrompt(text, url, origin), 300))
  return extracted.school_hours ? { ...info, school_hours: extracted.school_hours } : info
}

async function extractTermDates(content: string, maxTokens = 2048, locale = 'en-GB'): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0]

  // UK uses detailed prompt to handle end-of-term inference and section headings;
  // other locales use the shared variant prompts which are simpler but correct.
  const promptBody = locale === 'en-GB'
    ? `Extract all UK school term dates from this content. Today is ${today}.

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
- Include: half-term holidays, school holidays, INSET days (also called Staff Training Days, Teacher Training Days, Training Days, Professional Development Days, or any event where school is closed to students/pupils), bank holidays that affect school
- Include holiday PERIODS — if you see "last day of term / END OF TERM: X" and "first day of next term / all students return: Y", infer the holiday runs from X+1 to Y-1 and include it (e.g. "Summer Holiday", "Christmas Holiday", "Easter Holiday")
- "END OF TERM" on a line means that date is the last school day of that term
- Lines containing "(school closed to students)" or "(school closed to pupils)" are INSET/closure days — label them "INSET Day"
- "Occasional day (school closed to students)" is also an INSET Day
- Events called "... Inset" (e.g. "Staff Target Setting Inset", "Trust Staff Inset") with "(school closed to students)" are INSET Days
- Many school calendars list dates WITHOUT the year (e.g. "Wednesday 3rd September") — use the term heading (e.g. "Autumn Term 2026") to determine the correct year for those dates
- The first date listed under each new term heading is the term start date for pupils (even if it says "Years 7 & 12 only" — it is still a school day); the holiday period ends the day before
- For single INSET days, end_date is null
- For multi-day periods always set end_date
- Use academic year context to determine the correct year for each date

Content:
${content.slice(0, 30000)}`
    : `${CLAUDE_EXTRACTION_PROMPTS[getLocaleConfig(locale).claudeVariant]}

Content:
${content.slice(0, 30000)}`

  const res = await callClaude(promptBody, maxTokens)

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


async function addTermDateEvents(
  familyId:    string,
  homepageUrl: string,
  termDates:   any[],
): Promise<number> {
  const { data: existing } = await supabase
    .from('family_events')
    .select('id, title, event_date, end_date')
    .eq('family_id', familyId)
    .eq('source', 'term_dates')

  // Map key → existing row so we can detect missing end_dates and update them
  const existingMap = new Map((existing ?? []).map((e: any) => [`${e.title}||${e.event_date}`, e]))

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 1)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  let added = 0
  for (const event of termDates) {
    if (!event.date || !event.title) continue
    if (event.date < cutoffStr) continue
    const key = `${event.title}||${event.date}`
    const prev = existingMap.get(key)

    if (prev) {
      // If the existing row has no end_date but the new data does, patch it
      if (event.end_date && !prev.end_date) {
        await supabase.from('family_events').update({ end_date: event.end_date }).eq('id', prev.id)
        console.log(`Updated end_date for "${event.title}" ${event.date} → ${event.end_date}`)
      }
      continue
    }

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


function respond(body: object): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
