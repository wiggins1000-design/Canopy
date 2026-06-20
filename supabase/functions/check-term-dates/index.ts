// Canopy — Supabase Edge Function: check-term-dates
//
// Scrapes school websites for term dates and stores them in a shared cache.
// Families using the same school URL share one cached copy — scraping only
// happens once per school regardless of how many families use it.
//
// ── Modes ────────────────────────────────────────────────────────────────────
//   Cron (monthly):  no body, x-webhook-token header = TERM_DATES_WEBHOOK_TOKEN
//   Manual trigger:  body = {}, Authorization header = user JWT
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY
//   TERM_DATES_WEBHOOK_TOKEN   (set same value in cron job header)
//   READER_URL                 canopy-reader Railway service URL
//   READER_SECRET              shared secret for reader service
//   SUPABASE_URL               (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy check-term-dates --no-verify-jwt --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const webhookToken  = Deno.env.get('TERM_DATES_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  const authHeader    = req.headers.get('authorization')

  let targetFamilyId: string | null = null

  if (incomingToken && webhookToken && incomingToken === webhookToken) {
    // Cron mode — process all families
  } else if (authHeader?.startsWith('Bearer ')) {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401, headers: CORS })
    const { data: memberRow } = await supabase
      .from('family_members').select('family_id').eq('user_id', user.id).single()
    if (!memberRow) return new Response('No family found', { status: 404, headers: CORS })
    targetFamilyId = memberRow.family_id
  } else {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  // ── Build school URL → families map ──────────────────────────────────────
  let query = supabase
    .from('info_bank')
    .select('family_id, data')
    .eq('section', 'school')

  if (targetFamilyId) query = query.eq('family_id', targetFamilyId)

  const { data: rows } = await query
  const urlToFamilies: Record<string, Set<string>> = {}

  for (const row of rows ?? []) {
    const raw = (row as any).data?.school_url as string | undefined
    if (!raw) continue
    const url = normalizeUrl(raw)
    if (!urlToFamilies[url]) urlToFamilies[url] = new Set()
    urlToFamilies[url].add((row as any).family_id)
  }

  if (Object.keys(urlToFamilies).length === 0) {
    return new Response(JSON.stringify({ ok: true, message: 'No school URLs configured' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Process all schools in parallel ──────────────────────────────────────
  const forceRefresh = !!targetFamilyId

  const results = await Promise.all(
    Object.entries(urlToFamilies).map(async ([homepageUrl, familyIds]) => {
      console.log(`Processing school: ${homepageUrl} (${familyIds.size} families)`)
      const result = await processSchool(homepageUrl, [...familyIds], forceRefresh)
        .catch((e: any) => ({ status: 'error', error: e?.message ?? 'Unknown error' }))
      return { homepageUrl, ...result }
    })
  )

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

// ── Core processing ───────────────────────────────────────────────────────────

async function processSchool(homepageUrl: string, familyIds: string[], forceRefresh: boolean) {
  try {
    const { data: cached } = await supabase
      .from('school_calendars')
      .select('*')
      .eq('homepage_url', homepageUrl)
      .maybeSingle()

    const ageMs   = cached?.last_fetched_at
      ? Date.now() - new Date(cached.last_fetched_at).getTime()
      : Infinity
    const isStale = ageMs > 30 * 24 * 60 * 60 * 1000

    let termDates: any[] = (cached as any)?.term_dates ?? []
    let resolvedSchoolName: string | null = (cached as any)?.school_name ?? null

    if (!cached || isStale || forceRefresh) {
      const existingHash = forceRefresh ? null : ((cached as any)?.content_hash ?? null)
      const scraped = await scrapeTermDates(homepageUrl, existingHash)

      if (scraped.unchanged) {
        await supabase.from('school_calendars')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('homepage_url', homepageUrl)
      }

      if (scraped.error) {
        console.error(`Scrape error for ${homepageUrl}:`, scraped.error)
        return { status: 'error', error: scraped.error }
      }

      if (scraped.termDates?.length) {
        termDates = scraped.termDates
        if (scraped.schoolName) resolvedSchoolName = scraped.schoolName
        await supabase.from('school_calendars').upsert({
          homepage_url:    homepageUrl,
          term_dates_url:  scraped.termDatesUrl,
          school_name:     scraped.schoolName,
          term_dates:      termDates,
          content_hash:    scraped.contentHash,
          last_fetched_at: new Date().toISOString(),
        }, { onConflict: 'homepage_url' })
      }
    }

    if (!termDates.length) return { status: 'no_dates' }

    let totalAdded = 0
    for (const familyId of familyIds) {
      const added = await applyTermDatesToFamily(familyId, termDates, resolvedSchoolName)
      if (added > 0) {
        await postTermDatesNotice(familyId, added, resolvedSchoolName)
      }
      await cleanTermDateDuplicates(familyId)
      totalAdded += added
    }

    return { status: 'ok', eventsAdded: totalAdded, totalDates: termDates.length }
  } catch (e: any) {
    console.error('processSchool error:', e)
    return { status: 'error', error: e.message }
  }
}

// ── Term dates notice post ────────────────────────────────────────────────────

async function postTermDatesNotice(familyId: string, addedCount: number, schoolName: string | null) {
  const school  = schoolName ? ` from ${schoolName}` : ''
  const content = `🗓️ ${addedCount} new school date${addedCount !== 1 ? 's' : ''}${school} added to the calendar.\nToggle the graduation cap on the calendar to view term dates and holidays.`

  const { error } = await supabase.rpc('create_notice_post', {
    p_family_id: familyId,
    p_content:   content,
    p_image_url: null,
    p_file_url:  null,
    p_file_name: null,
    p_tag:       'notification',
  })
  if (error) console.error('Failed to post term dates notice:', error)
}

// ── Two-hop scrape ────────────────────────────────────────────────────────────

async function scrapeTermDates(homepageUrl: string, existingHash: string | null) {
  const urlObj  = new URL(homepageUrl)
  const origin  = urlObj.origin
  const isDirectUrl = urlObj.pathname.length > 1 || urlObj.search.length > 0

  let termDatesUrl: string

  if (isDirectUrl) {
    console.log(`Using direct term dates URL: ${homepageUrl}`)
    termDatesUrl = homepageUrl
  } else {
    // Try a direct fetch of the homepage first — saves a Jina call for static sites
    const homepageContent = await fetchPage(homepageUrl)
    if (!homepageContent) return { error: 'Failed to fetch school homepage — the site may be blocking requests' }

    console.log(`Homepage fetched (${homepageContent.length} chars), searching for term dates link…`)

    // Try 1: Jina link summary — scan for term dates URL patterns
    const homepageLinks = await fetchJinaLinks(homepageUrl)
    const cleanedLinks  = homepageLinks.map(l => l.replace(/[)>\s]+$/, ''))
    console.log(`Homepage links found: ${cleanedLinks.length}`, cleanedLinks.slice(0, 30))
    let found = findTermDatesLinkByPattern(cleanedLinks)

    // Try 2: ask Claude to pick from the link list
    if (!found && cleanedLinks.length > 0) {
      console.log('Pattern match failed, asking Claude to pick…')
      found = await pickTermDatesLink(cleanedLinks, origin)
    }

    // Try 3: ask Claude to find a URL from page content
    if (!found) {
      console.log('Trying content-based search…')
      found = await findTermDatesUrl(homepageContent, origin)
    }

    // Try 4: common UK school URL patterns
    if (!found) {
      console.log('Trying common URL patterns…')
      found = await tryCommonPaths(origin)
    }

    // Try 5: homepage itself contains term dates
    if (!found) {
      const lc = homepageContent.toLowerCase()
      if (lc.includes('term') && (lc.includes('autumn') || lc.includes('spring') || lc.includes('summer'))) {
        found = homepageUrl
      }
    }

    if (!found) return { error: 'Could not find term dates page. Enter the direct URL of your school\'s term dates page in the School website field.' }
    termDatesUrl = found
  }

  console.log(`Term dates URL found: ${termDatesUrl}`)

  // Try direct fetch first; fall back to Jina only when the response looks like JS-rendered HTML
  const termDatesContent = await fetchPage(termDatesUrl)

  console.log(`Term dates content length: ${termDatesContent?.length ?? 0}`)
  console.log(`Term dates content preview: ${termDatesContent?.slice(0, 500) ?? 'EMPTY'}`)

  if (!termDatesContent) return { error: 'Failed to fetch term dates page' }

  const contentHash = await hashContent(termDatesContent)
  if (contentHash === existingHash) return { unchanged: true }

  console.log('Starting parallel Claude extraction...')
  const [htmlResult, docLinks] = await Promise.all([
    extractTermDates(termDatesContent),
    findDocumentLinksViaClaude(termDatesContent, termDatesUrl),
  ])
  let { termDates, schoolName } = htmlResult
  console.log(`Extracted ${termDates.length} events from HTML`)
  console.log(`Document links found by Claude: ${JSON.stringify(docLinks)}`)

  // Fetch all PDFs in parallel and merge any new dates
  if (docLinks.length > 0) {
    const pdfResults = await Promise.all(
      docLinks.map(async (docUrl: string) => {
        const docContent = await fetchPage(docUrl)
        if (!docContent) return { termDates: [], schoolName: null, url: docUrl }
        const result = await extractTermDates(docContent)
        return { ...result, url: docUrl }
      })
    )

    const seenKeys = new Set(termDates.map((e: any) => `${e.title}||${e.date}`))
    for (const result of pdfResults) {
      if (!schoolName && result.schoolName) schoolName = result.schoolName
      let added = 0
      for (const event of result.termDates) {
        const key = `${event.title}||${event.date}`
        if (!seenKeys.has(key)) { seenKeys.add(key); termDates.push(event); added++ }
      }
      if (added > 0) console.log(`Merged ${added} new events from ${result.url}`)
    }
  }

  console.log(`Total extracted: ${termDates.length} term date events`)

  if (!termDates.length) return { error: 'Found the term dates page but could not extract dates. If dates are in an image or scanned PDF they cannot be read automatically.' }

  return { termDatesUrl, termDates, contentHash, schoolName }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// Fetch page content using canopy-reader (Puppeteer + pdf-parse + Vision).
// Falls back to Jina if reader is not configured, then direct fetch.
async function fetchPage(url: string): Promise<string | null> {
  const readerUrl    = Deno.env.get('READER_URL')
  const readerSecret = Deno.env.get('READER_SECRET') ?? ''

  if (readerUrl) {
    try {
      const res = await fetch(`${readerUrl}/fetch?url=${encodeURIComponent(url)}`, {
        headers: { Authorization: `Bearer ${readerSecret}` },
        signal:  AbortSignal.timeout(40000),
      })
      if (res.ok) {
        const text = await res.text()
        if (text && looksLikeUsefulContent(text)) {
          console.log(`Reader fetch succeeded for ${url}: ${text.length} chars`)
          return text
        }
      }
    } catch (e: any) {
      console.warn(`Reader fetch failed for ${url}: ${e?.message} — falling back to Jina`)
    }
  }

  // Fallback: Jina (strips HTML boilerplate, handles most pages)
  const jina = await fetchViaJina(url)
  if (jina && looksLikeUsefulContent(jina)) {
    console.log(`Jina fetch succeeded for ${url}: ${jina.length} chars`)
    return jina
  }

  // Last resort: direct fetch
  console.log(`Jina insufficient for ${url}, trying direct fetch…`)
  const direct = await fetchDirect(url)
  if (direct && looksLikeUsefulContent(direct)) {
    console.log(`Direct fetch succeeded for ${url}: ${direct.length} chars`)
    return direct
  }

  return null
}

async function fetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Canopy/1.0; +https://canopy.app)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    })
    if (!res.ok) {
      console.log(`Direct fetch returned ${res.status} for ${url}`)
      return null
    }
    const contentType = res.headers.get('content-type') ?? ''
    // PDFs must go through Jina — raw binary bytes are unreadable by Claude
    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      console.log(`Direct fetch skipping PDF for ${url}, deferring to Jina`)
      return null
    }
    const text = await res.text()
    console.log(`Direct fetch OK for ${url}: ${text.length} chars, type: ${contentType}`)
    return text.slice(0, 15000)
  } catch (e) {
    console.log(`Direct fetch threw for ${url}:`, e)
    return null
  }
}

function looksLikeUsefulContent(text: string): boolean {
  if (text.length < 200) return false
  const lc = text.toLowerCase()
  // Reject pages that appear to be empty JS shells
  if (lc.includes('<noscript>') && !lc.includes('term') && !lc.includes('holiday')) return false
  // Must contain calendar-relevant keywords
  return lc.includes('term') || lc.includes('holiday') || lc.includes('inset') ||
         lc.includes('autumn') || lc.includes('spring') || lc.includes('summer')
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.error(`Jina returned ${res.status} for ${url}`)
      return null
    }
    const text = await res.text()
    console.log(`Jina fetched ${url}: ${text.length} chars`)
    return text.slice(0, 12000)
  } catch (e) {
    console.error(`Jina fetch failed for ${url}:`, e)
    return null
  }
}

// Fetch all links from a page using Jina's link summary header
async function fetchJinaLinks(url: string): Promise<string[]> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Accept':            'text/plain',
        'X-With-Links-Summary': 'all',
      },
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) return []
    const text = await res.text()
    const linksSection = text.split(/links\/buttons:|links:\n/i).pop() ?? ''
    const links: string[] = []
    for (const line of linksSection.split('\n')) {
      const m = line.match(/https?:\/\/[^\s]+/)
      if (m) links.push(m[0])
    }
    return [...new Set(links)].slice(0, 30)
  } catch {
    return []
  }
}

async function findTermDatesUrl(homepageContent: string, origin: string): Promise<string | null> {
  const res = await callClaude(
    `Find the term dates page URL on this UK school website.

School website origin: ${origin}

Homepage content (may be truncated):
${homepageContent}

Look for navigation links, menu items or page links related to:
"Term Dates", "School Calendar", "Key Dates", "Academic Calendar", "Term Times",
"Holiday Dates", "School Dates", "Dates & Deadlines", "Key Information", "Parents > Term Dates"

Rules:
- Return ONLY the URL as plain text, nothing else
- If the URL is relative (starts with / or is a path), prefix it with: ${origin}
- If you cannot find any relevant link at all, return exactly: null`,
    256
  )

  if (!res) return null
  const url = res.trim().replace(/^["']|["']$/g, '')
  if (!url || url === 'null' || url.includes(' ') || url.length > 300) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/')) return `${origin}${url}`
  try { return new URL(url, origin).href } catch { return null }
}

function findTermDatesLinkByPattern(links: string[]): string | null {
  const patterns = [/term.?dates/i, /term.?times/i, /school.?calendar/i, /key.?dates/i, /holiday.?dates/i, /school.?dates/i, /academic.?calendar/i, /dates.?deadlines/i]
  for (const link of links) {
    for (const p of patterns) {
      if (p.test(link)) return link
    }
  }
  return null
}

async function pickTermDatesLink(links: string[], origin: string): Promise<string | null> {
  const res = await callClaude(
    `From this list of URLs from a UK school website (${origin}), return the single URL most likely to be the term dates or school calendar page.
Return ONLY the URL — nothing else. If none are relevant, return: null

URLs:
${links.slice(0, 40).join('\n')}`,
    128
  )
  if (!res) return null
  const url = res.trim().replace(/^["']|["']$/g, '')
  if (!url || url === 'null' || url.includes(' ') || url.length > 300) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/')) return `${origin}${url}`
  try { return new URL(url, origin).href } catch { return null }
}

async function tryCommonPaths(origin: string): Promise<string | null> {
  const paths = [
    '/term-dates', '/term-dates/', '/term_dates', '/termdates',
    '/parents/term-dates', '/parents-and-carers/term-dates',
    '/key-information/term-dates', '/school-information/term-dates',
    '/about/term-dates', '/about-us/term-dates',
    '/calendar', '/school-calendar', '/academic-calendar',
    '/parents/calendar', '/key-information/calendar',
    '/term-times', '/parents/term-times',
    '/holiday-dates', '/school-dates',
  ]

  const checks = await Promise.all(
    paths.map(async (path) => {
      try {
        const url = `${origin}${path}`
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
        return res.ok ? url : null
      } catch { return null }
    })
  )
  const url = checks.find(Boolean) ?? null
  if (url) console.log(`Found via common path: ${url}`)
  return url
}

async function findDocumentLinksViaClaude(content: string, pageUrl: string): Promise<string[]> {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  const res = await callClaude(
    `Find links to downloadable documents (PDFs, Word files, spreadsheets) on this school webpage that contain term dates, school holidays, or academic calendars — i.e. when the school is open or closed.

Include documents labelled: term dates, school calendar, academic calendar, holiday dates, school dates, key dates, term times.
Exclude documents that are ONLY about: exam timetables, GCSE/A-level schedules, PPE schedules, prospectuses, policies, or handbooks (unless they also contain holiday dates).

Base URL: ${pageUrl}

Return ONLY a JSON array of complete URLs. For relative URLs (starting with /), prefix with ${origin}.
Return [] if none found. No explanation.

Page content:
${content.slice(0, 8000)}`,
    512
  )
  if (!res) return []
  try {
    const parsed = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((u: any) => typeof u === 'string' && u.startsWith('http') && !u.includes(' '))
      .slice(0, 5)
  } catch { return [] }
}

async function extractTermDates(content: string): Promise<{ termDates: any[], schoolName: string | null }> {
  const today = new Date().toISOString().split('T')[0]

  const res = await callClaude(
    `Extract all UK school term dates from this content. Today is ${today}.

The content may come from a webpage, PDF, or Word document. Dates may be in tables, lists, or paragraphs.
Common formats: "Monday 4 September", "4th September 2025", "04/09/2025", "September 4".

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name": "name of the school or null",
  "events": [
    {
      "title": "clear title e.g. Half Term / Christmas Holiday / Easter Holiday / Summer Holiday / INSET Day",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null (use for multi-day holidays and half terms)"
    }
  ]
}

Rules:
- Include ALL academic years shown — past, present and future
- Include: half-term holidays, school holidays (Christmas, Easter, summer), INSET days, bank holidays
- Do NOT include term start dates or term end dates — only closed/holiday periods and INSET days
- Do NOT include exam periods, assessment weeks, PPE (Pre-Public Exams), GCSE/A-level exam timetables, or any event where school is open for exams
- For multi-day holiday periods always set end_date
- Use the academic year context to determine the correct year for each date
- If a table shows holiday date ranges, create one event per holiday period with start and end_date
- Summer holiday inference: many schools list when Summer Term ends and when Autumn Term begins without explicitly naming the "Summer Holiday". If the content shows a Summer Term end date and an Autumn Term start date (or INSET day) with no Summer Holiday in between, infer a "Summer Holiday" event: date = the day after the last day of Summer Term, end_date = the day before the first school day or INSET day of Autumn Term. Do not infer one if a Summer Holiday is already listed explicitly.

Content:
${content.slice(0, 12000)}`,
    2048
  )

  console.log('extractTermDates content preview:', content.slice(0, 300))
  console.log('Claude raw response:', res)

  if (!res) return { termDates: [], schoolName: null }

  try {
    const json = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return { termDates: json.events ?? [], schoolName: json.school_name ?? null }
  } catch (e) {
    console.error('Failed to parse Claude term dates response:', e)
    console.error('Raw response was:', res)
    return { termDates: [], schoolName: null }
  }
}

// ── Apply to family ───────────────────────────────────────────────────────────

async function applyTermDatesToFamily(familyId: string, termDates: any[], schoolName: string | null): Promise<number> {
  const { data: existing } = await supabase
    .from('family_events')
    .select('title, event_date')
    .eq('family_id', familyId)
    .eq('source', 'term_dates')

  const existingKeys = new Set((existing ?? []).map((e: any) => `${e.title}||${e.event_date}`))

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 1)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const sourceSubject = schoolName ?? 'School term dates'

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
      p_source_subject: sourceSubject,
    })

    if (error) {
      console.error('create_family_event error:', error)
    } else {
      added++
    }
  }

  return added
}

// ── Clean up email-AI events that duplicate official term dates ───────────────

async function cleanTermDateDuplicates(familyId: string): Promise<void> {
  const patterns = [
    '%half term%', '%half-term%',
    '%end of term%', '%last day of term%', '%first day of term%',
    '%term start%', '%term end%', '%term begin%',
    '%school holiday%', '%school break%', '%school closed%', '%school closes%', '%school returns%',
    '%inset day%',
    '%christmas holid%', '%easter holid%', '%summer holid%',
    '%spring holid%', '%autumn holid%',
  ]
  const { error } = await supabase
    .from('family_events')
    .delete()
    .eq('family_id', familyId)
    .eq('source', 'email_ai')
    .or(patterns.map(p => `title.ilike.${p}`).join(','))
  if (error) console.error('cleanTermDateDuplicates error:', error)
  else console.log(`Cleaned up email_ai term date duplicates for family ${familyId}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const hasPath = u.pathname.length > 1 || u.search.length > 0
    const base    = `${u.protocol}//${u.hostname}`.toLowerCase()
    return hasPath ? (base + u.pathname + u.search).toLowerCase() : base
  } catch {
    return url.toLowerCase().replace(/\/$/, '')
  }
}

async function hashContent(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content)
  const buf     = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function callClaude(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); return null }
  console.log(`callClaude: ${maxTokens} tokens, prompt ${prompt.length} chars`)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    console.log(`callClaude: response status ${res.status}`)
    if (!res.ok) {
      console.error('Claude error:', await res.text())
      return null
    }
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch (e: any) {
    console.error('callClaude fetch threw:', e?.name, e?.message)
    return null
  }
}
