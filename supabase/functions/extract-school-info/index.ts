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
  const { family_id, child_name, school_url, image_base64, image_media_type } = await req.json()
  if (!school_url && !image_base64) {
    return new Response(JSON.stringify({ error: 'school_url or image_base64 required' }), { status: 400, headers: CORS })
  }

  // ── Image upload mode ─────────────────────────────────────────────────────
  if (image_base64) {
    try {
      const mediaType = (['image/jpeg','image/png','image/gif','image/webp'].includes(image_media_type)
        ? image_media_type : 'image/jpeg') as 'image/jpeg'|'image/png'|'image/gif'|'image/webp'

      console.log(`Image upload mode — media type: ${mediaType}`)
      const imageText = await extractTextFromImage(image_base64, mediaType)
      if (!imageText) {
        return respond({ error: 'Could not read text from the image. Please try a clearer photo.' })
      }

      let termDates = await extractTermDates(imageText, 4096)
      const inferred = [...inferSummerHolidays(imageText), ...inferInsetDays(imageText)]
      const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
      for (const d of inferred) {
        if (d.date && !existingKeys.has(`${d.title}||${d.date}`)) termDates.push(d)
      }
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

  // Cache key is always just the hostname — path URLs still share the same school cache
  const normalised = normaliseUrl(school_url)

  // If the user pasted a specific page URL (e.g. /term-dates), use it directly
  // to bypass bot-protected homepages.
  const parsedInput = (() => {
    try { return new URL(school_url.startsWith('http') ? school_url : `https://${school_url}`) }
    catch { return null }
  })()
  const hasPath = !!(parsedInput && parsedInput.pathname.length > 1)

  console.log(`extract-school-info: ${normalised}${hasPath ? ` (direct path: ${parsedInput!.pathname})` : ''}`)

  try {
    // ── Cache check (always — keyed on hostname) ──────────────────────────────
    const { data: cached } = await supabase
      .from('school_calendars')
      .select('*')
      .eq('homepage_url', normalised)
      .maybeSingle()

    const cacheAgeMs = cached?.last_fetched_at
      ? Date.now() - new Date(cached.last_fetched_at).getTime()
      : Infinity
    const cacheValid = cacheAgeMs < 30 * 24 * 60 * 60 * 1000   // 30 days

    let termDates: any[]     = cached?.term_dates ?? []
    let termDatesUrl: string = cached?.term_dates_url ?? normalised

    if (hasPath) {
      // ── Path URL mode: fetch the given URL directly for term dates ─────────
      // This avoids the bot-blocked homepage entirely.
      const directUrl = parsedInput!.href
      termDatesUrl = directUrl

      console.log(`Path URL mode — fetching: ${directUrl}`)
      // Reader first (Jina is its built-in fallback); Direct as last resort
      let pageText: string | null = null
      for (const [label, fetchFn] of [
        ['Reader', () => fetchViaReader(directUrl)],
        ['Direct', () => fetchDirect(directUrl)],
      ] as [string, () => Promise<string | null>][]) {
        const text = await fetchFn()
        if (text && !isBotBlocked(text)) {
          pageText = text
          console.log(`${label} succeeded: ${text.length} chars`)
          break
        }
        if (text) console.log(`${label} returned bot-blocked content`)
        else console.log(`${label} returned null`)
      }
      if (!pageText) {
        return respond({ error: 'This school\'s website has bot protection that is blocking access. Please enter the school details manually.' })
      }

      // Extract school info from this page (best effort — may only yield school name)
      let schoolInfo = await extractSchoolInfo(pageText, directUrl)
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
      console.log('Path page extraction:', JSON.stringify(schoolInfo))

      // Fetch + extract term dates
      if (!cacheValid || termDates.length === 0) {
        termDates = await extractTermDates(pageText, 4096)

        const pdfUrls = extractPdfUrls(pageText)
        const pdfTexts: string[] = []
        for (const pdfUrl of pdfUrls) {
          console.log(`Fetching term dates PDF: ${pdfUrl}`)
          const pdfText = await fetchViaReader(pdfUrl)
          if (pdfText && pdfText.length > 50) {
            pdfTexts.push(pdfText)
            const pdfDates = await extractTermDates(pdfText, 4096)
            const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
            for (const d of pdfDates) {
              if (d.date && d.title && !existingKeys.has(`${d.title}||${d.date}`)) termDates.push(d)
            }
          }
        }

        // TypeScript inference runs on all content regardless of whether PDFs were found
        const combined = pdfTexts.length > 0 ? [pageText, ...pdfTexts].join('\n\n---\n\n') : pageText
        const inferred = [...inferSummerHolidays(combined), ...inferInsetDays(combined)]
        const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
        for (const d of inferred) {
          if (d.date && !existingKeys.has(`${d.title}||${d.date}`)) {
            termDates.push(d)
            console.log(`Inferred: ${d.title} ${d.date}${'end_date' in d && d.end_date ? ` – ${d.end_date}` : ''}`)
          }
        }

        console.log(`Extracted ${termDates.length} term dates (path URL mode)`)
      } else {
        console.log(`Cache hit — reusing ${termDates.length} cached term dates`)
      }

      if (family_id && child_name) await storeSchoolInfo(family_id, child_name, schoolInfo)
      await cacheSchoolData(normalised, termDatesUrl, termDates, schoolInfo)
      let eventsAdded = 0
      if (termDates.length > 0 && family_id) {
        eventsAdded = await addTermDateEvents(family_id, normalised, termDates)
        copyToSiblingFamilies(normalised, termDates, family_id)   // fire-and-forget
      }
      return respond({ ok: true, school_info: schoolInfo, term_dates: termDates.length, events_added: eventsAdded })
    }

    // ── Homepage mode ─────────────────────────────────────────────────────────

    // ── Step 1: fetch homepage ────────────────────────────────────────────────
    const homepageText = await fetchViaReader(normalised)
    if (!homepageText) {
      return respond({ error: 'Could not fetch school homepage. Check the URL is correct.' })
    }
    if (isBotBlocked(homepageText)) {
      return respond({ error: 'This school\'s website has bot protection that is blocking access. Try entering the URL of the specific term dates page instead (e.g. https://school.com/term-dates), or enter the school details manually.' })
    }

    // ── Step 2: extract school info from homepage ─────────────────────────────
    const origin = (() => { try { return new URL(normalised).origin } catch { return normalised } })()
    let schoolInfo = await extractSchoolInfo(homepageText, normalised)
    console.log('Homepage extraction:', JSON.stringify(schoolInfo))

    // Fill contact blanks from cache — avoids extra requests when another family already fetched this school
    if (cached) {
      schoolInfo = {
        ...schoolInfo,
        school_address: schoolInfo.school_address ?? cached.school_address ?? null,
        school_email:   schoolInfo.school_email   ?? cached.school_email   ?? null,
        school_phone:   schoolInfo.school_phone   ?? cached.school_phone   ?? null,
        head_teacher:   schoolInfo.head_teacher   ?? cached.head_teacher   ?? null,
        school_hours:   schoolInfo.school_hours   ?? cached.school_hours   ?? null,
      }
      if (cached.school_address || cached.school_email || cached.school_phone)
        console.log('Contact info populated from cache')
    }

    // If contact details are missing, fetch the contact page
    if (isMissingContactInfo(schoolInfo)) {
      schoolInfo = await enrichFromContactPage(schoolInfo, normalised, origin)
      console.log('After contact page enrichment:', JSON.stringify(schoolInfo))
    }

    // If school hours still missing, try a school-day/times page
    if (!schoolInfo.school_hours) {
      schoolInfo = await enrichFromSchoolDayPage(schoolInfo, origin)
      console.log('After school day enrichment:', JSON.stringify(schoolInfo))
    }

    if (schoolInfo.term_dates_url) termDatesUrl = schoolInfo.term_dates_url

    // ── Step 3: fetch + extract term dates (skip if cache is fresh) ───────────
    if (!cacheValid || termDates.length === 0) {
      console.log('Cache miss — fetching term dates')
      let termDatesText = ''

      if (termDatesUrl && termDatesUrl !== normalised) {
        console.log(`Fetching term dates from: ${termDatesUrl}`)
        termDatesText = await fetchViaReader(termDatesUrl) ?? ''
      }

      if (!termDatesText) {
        const found = await tryCommonTermDatePaths(normalised)
        if (found) { termDatesUrl = found.url; termDatesText = found.text }
      }

      if (termDatesText) {
        // Separate extractions per source (reliable, avoids cross-doc deduplication)
        termDates = await extractTermDates(termDatesText, 4096)

        const pdfUrls = extractPdfUrls(termDatesText)
        const pdfTexts: string[] = []
        for (const pdfUrl of pdfUrls) {
          console.log(`Fetching term dates PDF: ${pdfUrl}`)
          const pdfText = await fetchViaReader(pdfUrl)
          if (pdfText && pdfText.length > 50) {
            pdfTexts.push(pdfText)
            const pdfDates = await extractTermDates(pdfText, 4096)
            const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
            for (const d of pdfDates) {
              if (d.date && d.title && !existingKeys.has(`${d.title}||${d.date}`)) termDates.push(d)
            }
          }
        }

        // TypeScript inference runs on all content regardless of whether PDFs were found
        const combined = pdfTexts.length > 0 ? [termDatesText, ...pdfTexts].join('\n\n---\n\n') : termDatesText
        const inferred = [...inferSummerHolidays(combined), ...inferInsetDays(combined)]
        const existingKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
        for (const d of inferred) {
          if (d.date && !existingKeys.has(`${d.title}||${d.date}`)) {
            termDates.push(d)
            console.log(`Inferred: ${d.title} ${d.date}${'end_date' in d && d.end_date ? ` – ${d.end_date}` : ''}`)
          }
        }

        console.log(`Extracted ${termDates.length} term dates total (inc. PDFs)`)
      }
    } else {
      console.log(`Cache hit — reusing ${termDates.length} cached term dates`)
    }

    // ── Step 4: store school info in info_bank ────────────────────────────────
    if (family_id && child_name) {
      await storeSchoolInfo(family_id, child_name, schoolInfo)
    }

    // ── Step 5: cache contact info + term dates (always, so other families benefit) ──
    await cacheSchoolData(normalised, termDatesUrl, termDates, schoolInfo)

    // ── Step 6: add term date events for this family + all sibling families ─────
    let eventsAdded = 0
    if (termDates.length > 0 && family_id) {
      eventsAdded = await addTermDateEvents(family_id, normalised, termDates)
      copyToSiblingFamilies(normalised, termDates, family_id)   // fire-and-forget
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

// ── Shared date helpers for TypeScript inference ──────────────────────────────

const _MONTH_NUMS: Record<string, number> = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
}
const _DATE_PAT = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i

function _parseDate(s: string): string | null {
  const m = s.match(_DATE_PAT)
  if (!m) return null
  const d = parseInt(m[1]), mo = _MONTH_NUMS[m[2].toLowerCase()], y = parseInt(m[3])
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function _shiftDay(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}
function _datesIn(snippet: string): string[] {
  const out: string[] = []
  for (const m of snippet.matchAll(new RegExp(_DATE_PAT.source, 'gi'))) {
    const d = _parseDate(m[0]); if (d) out.push(d)
  }
  return out
}

// Infer summer holiday from "last day of term" + "first day back for pupils"
function inferSummerHolidays(allContent: string): Array<{title: string, date: string, end_date: string}> {
  const text = allContent.replace(/\*\*/g, ' ')

  const lastDays: string[] = []
  for (const m of text.matchAll(/last\s+day\s+of\s+(?:the\s+)?(?:summer\s+)?term.{0,120}/gi))
    _datesIn(m[0]).forEach(d => lastDays.push(d))

  // UK schools use many different phrases for when pupils return in September
  const firstDays: string[] = []
  for (const pat of [
    /term\s+begins?\s+for\s+(?:all\s+)?pupils?.{0,80}/gi,
    /pupils?\s+(?:return|back\s+to\s+school|re-?join).{0,80}/gi,
    /children\s+return.{0,80}/gi,
    /school\s+re-?opens?\s+for\s+pupils?.{0,80}/gi,
    /first\s+day\s+(?:of\s+(?:the\s+)?)?(?:autumn\s+)?term\s+for\s+pupils?.{0,80}/gi,
    /first\s+day\s+of\s+(?:the\s+)?(?:autumn\s+)?term.{0,80}/gi,   // less specific, last resort
  ]) {
    for (const m of text.matchAll(pat)) _datesIn(m[0]).forEach(d => firstDays.push(d))
  }

  const results: Array<{title: string, date: string, end_date: string}> = []
  for (const lastDay of lastDays) {
    const mo = parseInt(lastDay.split('-')[1])
    if (mo < 6 || mo > 7) continue
    const nextFirst = [...new Set(firstDays)].filter(d => d > lastDay).sort()[0]
    if (!nextFirst) continue
    const nextMo = parseInt(nextFirst.split('-')[1])
    if (nextMo < 8 || nextMo > 9) continue
    results.push({ title: 'Summer Holiday', date: _shiftDay(lastDay, 1), end_date: _shiftDay(nextFirst, -1) })
  }
  return results
}

// Infer INSET days from "Staff Training Day(s)" and equivalent labels
function inferInsetDays(allContent: string): Array<{title: string, date: string, end_date: null}> {
  const text = allContent.replace(/\*\*/g, ' ')
  const results: Array<{title: string, date: string, end_date: null}> = []

  for (const pat of [
    /(?:inset|staff\s+training|teacher\s+training|training|professional\s+development)\s+days?[^\n]{0,300}/gi,
  ]) {
    for (const m of text.matchAll(pat)) {
      for (const date of _datesIn(m[0])) {
        results.push({ title: 'INSET Day', date, end_date: null })
      }
    }
  }
  return results
}

function extractPdfUrls(content: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const addUrl = (u: string) => {
    const clean = u.replace(/[)\]"'>\s]+$/, '')
    if (clean && !seen.has(clean)) { seen.add(clean); urls.push(clean) }
  }
  // Markdown links to PDFs — by .pdf extension OR type=pdf / format=pdf query param
  for (const m of content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]*(?:\.pdf|[?&]type=pdf|[?&]format=pdf)[^)]*)\)/gi)) addUrl(m[1])
  // Bare PDF URLs
  for (const m of content.matchAll(/https?:\/\/\S+(?:\.pdf|[?&]type=pdf|[?&]format=pdf)\S*/gi)) addUrl(m[0])
  return urls.slice(0, 5)
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

  // 3. Try common path patterns
  for (const path of ['/contact', '/contact-us', '/contacts', '/about/contact', '/about-us/contact', '/school-information/contact', '/key-information/contact']) {
    try {
      const r = await fetch(`${origin}${path}`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
      if (r.ok) return `${origin}${path}`
    } catch { /* not found */ }
  }

  return null
}

async function enrichFromContactPage(info: SchoolInfo, homepageUrl: string, origin: string): Promise<SchoolInfo> {
  const contactUrl = await findContactUrl(homepageUrl, origin, info.contact_url)
  if (!contactUrl) {
    console.log('No contact page found')
    return info
  }

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

async function enrichFromSchoolDayPage(info: SchoolInfo, origin: string): Promise<SchoolInfo> {
  const paths = [
    '/school-day', '/school-day/', '/school-times', '/school-hours',
    '/parents/school-day', '/parents/school-times', '/parents-and-carers/school-day',
    '/key-information/school-day', '/key-information/school-times',
    '/school-information/school-day', '/about/school-day',
    '/our-school/school-day', '/school-life/school-day',
  ]

  for (const path of paths) {
    const url = `${origin}${path}`
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) })
      if (!head.ok) continue
      const text = await fetchViaReader(url)
      if (!text || text.length < 100) continue
      console.log(`Fetching school day page: ${url}`)
      const extracted = parseSchoolInfoJson(await callClaude(buildSchoolInfoPrompt(text, url, origin), 300))
      if (extracted.school_hours) {
        return { ...info, school_hours: extracted.school_hours }
      }
    } catch { /* not found */ }
  }

  return info
}

async function extractTermDates(content: string, maxTokens = 2048): Promise<any[]> {
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
- Include: half-term holidays, school holidays, INSET days (also called Staff Training Days, Teacher Training Days, Training Days, Professional Development Days), bank holidays that affect school
- Include holiday PERIODS — if you see "last day of term: X" and "first day of next term: Y", infer the holiday runs from X+1 to Y-1 and include it (e.g. "Summer Holiday", "Christmas Holiday", "Easter Holiday")
- For single INSET days, end_date is null
- For multi-day periods always set end_date
- Use academic year context to determine the correct year for each date

Content:
${content.slice(0, 30000)}`,
    maxTokens
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

async function cacheSchoolData(
  homepageUrl:  string,
  termDatesUrl: string,
  termDates:    any[],
  info:         SchoolInfo,
): Promise<void> {
  const contentHash = await hashString(JSON.stringify(termDates))
  await supabase.from('school_calendars').upsert({
    homepage_url:    homepageUrl,
    term_dates_url:  termDatesUrl,
    school_name:     info.school_name     ?? undefined,
    school_address:  info.school_address  ?? undefined,
    school_email:    info.school_email    ?? undefined,
    school_phone:    info.school_phone    ?? undefined,
    head_teacher:    info.head_teacher    ?? undefined,
    school_hours:    info.school_hours    ?? undefined,
    term_dates:      termDates,
    content_hash:    contentHash,
    last_fetched_at: new Date().toISOString(),
  }, { onConflict: 'homepage_url' })
}

async function addTermDateEvents(
  familyId:    string,
  homepageUrl: string,
  termDates:   any[],
): Promise<number> {
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

async function copyToSiblingFamilies(homepageUrl: string, termDates: any[], excludeFamilyId: string): Promise<void> {
  try {
    const { data: rows } = await supabase
      .from('info_bank')
      .select('family_id, data')
      .eq('section', 'school')

    const seen = new Set<string>()
    for (const row of rows ?? []) {
      if (row.family_id === excludeFamilyId) continue
      if (seen.has(row.family_id)) continue
      const schoolUrl = (row.data as any)?.school_url
      if (!schoolUrl) continue
      try { if (normaliseUrl(schoolUrl) !== homepageUrl) continue } catch { continue }
      seen.add(row.family_id)
      const added = await addTermDateEvents(row.family_id, homepageUrl, termDates)
      if (added > 0) console.log(`Copied ${added} term dates to sibling family ${row.family_id}`)
    }
  } catch (e: any) {
    console.warn('copyToSiblingFamilies failed:', e?.message)
  }
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
