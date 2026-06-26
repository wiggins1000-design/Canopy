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

  // ── Cron housekeeping ─────────────────────────────────────────────────────
  const forceRefresh = !targetFamilyId
  if (forceRefresh) {
    const { error: archiveErr } = await supabase.rpc('archive_old_notifications')
    if (archiveErr) console.error('archive_old_notifications error:', archiveErr)
    else console.log('archive_old_notifications: done')
  }

  // ── Process all schools in parallel ──────────────────────────────────────
  // forceRefresh is only true for the monthly cron (targetFamilyId is null in cron mode).
  // Manual sync uses cached KB data when available; only scrapes if KB is empty.

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
    // Also re-scrape if the cache exists but has no dates (previous scrape failed silently)
    const isStale = ageMs > 30 * 24 * 60 * 60 * 1000 || !((cached as any)?.term_dates?.length)

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
        if ((scraped as any).diagnostic) {
          await storeDiagnostic(homepageUrl, scraped.error, (scraped as any).diagnostic)
        }
        return { status: 'error', error: scraped.error }
      }

      if (scraped.termDates?.length) {
        termDates = scraped.termDates
        if (scraped.schoolName) resolvedSchoolName = scraped.schoolName
        await supabase.from('school_calendars').upsert({
          homepage_url:     homepageUrl,
          term_dates_url:   scraped.termDatesUrl,
          school_name:      scraped.schoolName,
          term_dates:       termDates,
          content_hash:     scraped.contentHash,
          last_fetched_at:  new Date().toISOString(),
          scrape_error:     null,
          scrape_error_at:  null,
          scrape_diagnosis: null,
        }, { onConflict: 'homepage_url' })
      }
    }

    if (!termDates.length) return { status: 'no_dates', error: 'no_dates' }

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
    // Try 1: sitemap.xml — single request, no homepage fetch needed if this succeeds
    let found: string | null = await fetchSitemapTermDatesUrl(origin)
    let linksForDiagnostic: string[] = []  // hoisted so discovery-failure diagnostic can include them

    if (!found) {
      // Fetch homepage via reader (relaxed check — any real page, not just calendar-keyword pages)
      const homepageContent = await fetchHomepage(homepageUrl)
      if (!homepageContent) return { error: 'Failed to fetch school homepage — the site may be blocking requests', diagnostic: { error_type: 'homepage_fetch_failed' } }

      console.log(`Homepage fetched (${homepageContent.length} chars), searching for term dates link…`)

      // Try 2: extract links from reader content — scan for term dates URL patterns.
      // Reader returns innerText and Jina returns markdown — neither has href attributes.
      // When the homepage content is plaintext, always fetch raw HTML to recover nav links.
      let links = extractLinksFromContent(homepageContent, origin)
      if (!homepageContent.includes('href=')) {
        console.log('Homepage content is plaintext (no hrefs), fetching raw HTML for nav links…')
        const rawHtml = await fetchDirect(homepageUrl)
        if (rawHtml) {
          const htmlLinks = extractLinksFromContent(rawHtml, origin)
          links = [...new Set([...links, ...htmlLinks])]
          console.log(`Raw HTML added ${htmlLinks.length} links (total ${links.length})`)
        }
      }
      linksForDiagnostic = links  // snapshot for diagnostic use if discovery fails
      found = findTermDatesLinkByPattern(links)

      // Try 3: common UK school URL patterns — fast HEAD checks, no Claude needed
      // Run before Claude because large school homepages (1MB+) often exceed the raw HTML
      // fetch cap so nav links are missing, leaving Claude with irrelevant links to guess from.
      if (!found) {
        console.log('Pattern match failed, trying common URL patterns…')
        found = await tryCommonPaths(origin)
      }

      // Try 4: ask Claude to pick from the link list
      if (!found && links.length > 0) {
        console.log('Common paths failed, asking Claude to pick…')
        found = await pickTermDatesLink(links, origin)
      }

      // Try 5: ask Claude to find a URL from page content
      if (!found) {
        console.log('Trying content-based search…')
        found = await findTermDatesUrl(homepageContent, origin)
      }

      // Try 6: homepage itself contains term dates
      if (!found) {
        const lc = homepageContent.toLowerCase()
        if (lc.includes('term') && (lc.includes('autumn') || lc.includes('spring') || lc.includes('summer'))) {
          found = homepageUrl
        }
      }
    }

    if (!found) return { error: 'Could not find term dates page on this school\'s website.', diagnostic: { error_type: 'discovery_failed', links_found: linksForDiagnostic.slice(0, 30) } }
    termDatesUrl = found
  }

  console.log(`Term dates URL found: ${termDatesUrl}`)

  // Try direct fetch first; fall back to Jina only when the response looks like JS-rendered HTML
  const termDatesContent = await fetchPage(termDatesUrl)

  console.log(`Term dates content length: ${termDatesContent?.length ?? 0}`)
  console.log(`Term dates content preview: ${termDatesContent?.slice(0, 500) ?? 'EMPTY'}`)

  if (!termDatesContent) return { error: 'Failed to fetch term dates page', diagnostic: { error_type: 'page_fetch_failed', term_dates_url: termDatesUrl } }

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
  const uniqueDocLinks = [...new Set(docLinks as string[])]
  if (uniqueDocLinks.length !== docLinks.length) {
    console.log(`Deduped docLinks: ${docLinks.length} → ${uniqueDocLinks.length}`)
  }
  if (uniqueDocLinks.length > 0) {
    const pdfResults = await Promise.all(
      uniqueDocLinks.map(async (docUrl: string) => {
        const docContent = await fetchPage(docUrl)
        if (!docContent) return { termDates: [], schoolName: null, url: docUrl }
        const result = await extractTermDates(docContent)
        return { ...result, url: docUrl }
      })
    )

    const seenKeys = new Set(termDates.map((e: any) => `${(e.title ?? '').toLowerCase()}||${e.date}`))
    for (const result of pdfResults) {
      if (!schoolName && result.schoolName) schoolName = result.schoolName
      let added = 0
      for (const event of result.termDates) {
        const key = `${(event.title ?? '').toLowerCase()}||${event.date}`
        if (!seenKeys.has(key)) { seenKeys.add(key); termDates.push(event); added++ }
      }
      if (added > 0) console.log(`Merged ${added} new events from ${result.url}`)
    }
  }

  inferMissingHolidays(termDates)

  // Filter to school-closed events before saving to KB — removes term start/end
  // dates, pupils return days etc. so the KB only contains calendar-worthy events.
  // inferMissingHolidays must run first as it needs term-end events to find gaps.
  termDates = termDates.filter((e: any) => e.title && isSchoolClosedEvent(e.title))
  console.log(`Total events for KB: ${termDates.length}`)

  if (!termDates.length) return { error: 'Found the term dates page but could not extract dates. If dates are in an image or scanned PDF they cannot be read automatically.', diagnostic: { error_type: 'extraction_failed', term_dates_url: termDatesUrl, content_preview: termDatesContent.slice(0, 600) } }

  return { termDatesUrl, termDates, contentHash, schoolName }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// Fetch homepage — relaxed content check (just needs to be a real page, not bot-blocked).
// Used for the first hop so school homepages without calendar keywords aren't rejected.
async function fetchHomepage(url: string): Promise<string | null> {
  return fetchPageWithCheck(url, isRealPage)
}

// Fetch term dates page — strict check requires calendar-relevant keywords.
async function fetchPage(url: string): Promise<string | null> {
  return fetchPageWithCheck(url, looksLikeUsefulContent)
}

async function fetchPageWithCheck(url: string, check: (t: string) => boolean): Promise<string | null> {
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
        if (text && check(text)) {
          console.log(`Reader fetch succeeded for ${url}: ${text.length} chars`)
          return text
        }
        if (text) console.log(`Reader returned content but failed check for ${url} (${text.length} chars)`)
      }
    } catch (e: any) {
      console.warn(`Reader fetch failed for ${url}: ${e?.message} — falling back to Jina`)
    }
  }

  // Fallback: Jina
  const jina = await fetchViaJina(url)
  if (jina && check(jina)) {
    console.log(`Jina fetch succeeded for ${url}: ${jina.length} chars`)
    return jina
  }

  // Last resort: direct fetch
  console.log(`Jina insufficient for ${url}, trying direct fetch…`)
  const direct = await fetchDirect(url)
  if (direct && check(direct)) {
    console.log(`Direct fetch succeeded for ${url}: ${direct.length} chars`)
    return direct
  }

  return null
}

// Extract all links from reader-returned content (handles both markdown and raw HTML).
function extractLinksFromContent(content: string, origin: string): string[] {
  const seen = new Set<string>()
  const add = (raw: string) => {
    const url = raw.replace(/[.,;)>\]"'\s]+$/, '')
    if (url.startsWith('http') && !url.includes(' ') && url.length < 300) seen.add(url)
  }

  // HTML href attributes — catches raw HTML from reader (e.g. href="/106/term-dates")
  // Decode &amp; entities: HTML attribute values use &amp; for & but the URL needs bare &
  for (const m of content.matchAll(/href=["']([^"'#?][^"']*?)["']/gi)) {
    const href = m[1].trim().replace(/&amp;/g, '&')
    if (href.startsWith('http')) add(href)
    else if (href.startsWith('/')) add(`${origin}${href}`)
  }
  // Markdown links: [text](url) — absolute and relative
  for (const m of content.matchAll(/\[[^\]]*\]\((\/[^)"\s]+)\)/g)) add(`${origin}${m[1]}`)
  for (const m of content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)"\s]+)\)/g)) add(m[1])
  // Bare absolute URLs in text
  for (const m of content.matchAll(/https?:\/\/[^\s\])"<]+/g)) add(m[0])

  return [...seen]
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
    return text.slice(0, 60000)
  } catch (e) {
    console.log(`Direct fetch threw for ${url}:`, e)
    return null
  }
}

// Any real page — used for homepage fetching where calendar keywords aren't expected
function isRealPage(text: string): boolean {
  if (text.length < 200) return false
  const lc = text.toLowerCase()
  return !lc.includes('just a moment') && !lc.includes('captcha') &&
         !lc.includes('security verification') && !lc.includes('verifying you are not a bot') &&
         !lc.includes('enable javascript to continue')
}

// Term dates page — must contain calendar-relevant keywords
function looksLikeUsefulContent(text: string): boolean {
  if (text.length < 200) return false
  const lc = text.toLowerCase()
  if (lc.includes('<noscript>') && !lc.includes('term') && !lc.includes('holiday')) return false
  // Reject Jina-proxied 404 pages — Jina returns 200 with this warning in the body
  if (lc.includes('target url returned error 404')) return false
  // Reject cookie consent walls — keywords appear only in meta/title, not actual content
  if ((lc.includes('we value your privacy') || lc.includes('cookie consent') ||
       (lc.includes('accept all') && lc.includes('reject all'))) &&
      !(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text))) return false
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
    return text.slice(0, 30000)
  } catch (e) {
    console.error(`Jina fetch failed for ${url}:`, e)
    return null
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
  const decode = (url: string) => { try { return decodeURIComponent(url.replace(/\+/g, ' ')).toLowerCase() } catch { return url.toLowerCase() } }
  // Check each tier in priority order — both words must appear anywhere in the decoded URL
  const tiers: Array<(d: string) => boolean> = [
    d => d.includes('term') && d.includes('date'),
    d => d.includes('term') && d.includes('time'),
    d => d.includes('academic') && d.includes('calendar'),
    d => d.includes('school') && d.includes('calendar'),
    d => d.includes('key') && d.includes('date'),
    d => d.includes('holiday') && d.includes('date'),
    d => d.includes('school') && d.includes('date'),
    d => /\/calendar(?:$|[/?#])/.test(d),
  ]
  for (let i = 0; i < tiers.length; i++) {
    const match = links.find(l => tiers[i](decode(l)))
    if (match) return match
  }
  return null
}

async function pickTermDatesLink(links: string[], origin: string): Promise<string | null> {
  const res = await callClaude(
    `From this list of URLs from a UK school website (${origin}), return the single URL most likely to be the term dates, school calendar, or calendar page.
Look for URLs containing: term-dates, term-times, school-calendar, academic-calendar, key-dates, holiday-dates, school-dates, calendar.
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

// Fetch sitemap.xml and return the URL most likely to contain term dates/calendar.
// This is the fastest discovery method — one HTTP request, no Puppeteer, no Claude.
async function fetchSitemapTermDatesUrl(origin: string): Promise<string | null> {
  // Ordered by specificity — more specific patterns ranked higher
  const score = (url: string): number => {
    const d = (() => { try { return decodeURIComponent(url.replace(/\+/g, ' ')) } catch { return url } })().toLowerCase()
    if (d.includes('term') && d.includes('date'))          return 10
    if (d.includes('term') && d.includes('time'))          return 9
    if (d.includes('academic') && d.includes('calendar'))  return 8
    if (d.includes('school') && d.includes('calendar'))    return 7
    if (d.includes('key') && d.includes('date'))           return 6
    if (d.includes('holiday') && d.includes('date'))       return 5
    if (d.includes('school') && d.includes('date'))        return 4
    if (/\/calendar(?:$|[/?#])/i.test(url))               return 3
    return 0
  }

  const extractLocs = (xml: string): string[] =>
    [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim())

  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const res = await fetch(`${origin}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Canopy/1.0; +https://canopy.app)', Accept: 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (!res.ok) continue
      const xml = await res.text()
      let locs = extractLocs(xml)
      console.log(`Sitemap ${path}: ${locs.length} URLs`)

      // If it's a sitemap index, fetch child sitemaps and accumulate page URLs
      if (xml.includes('<sitemapindex')) {
        const childSitemaps = locs.filter(u => u.endsWith('.xml'))
        const childResults = await Promise.all(
          childSitemaps.slice(0, 5).map(async (childUrl) => {
            try {
              const cr = await fetch(childUrl, { signal: AbortSignal.timeout(5000), redirect: 'follow' })
              return cr.ok ? extractLocs(await cr.text()) : []
            } catch { return [] }
          })
        )
        locs = childResults.flat()
        console.log(`Sitemap index expanded to ${locs.length} page URLs`)
      }

      const scored = locs
        .map(url => ({ url, s: score(url) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)

      if (scored.length > 0) {
        console.log(`Sitemap match: ${scored[0].url} (score ${scored[0].s})`)
        return scored[0].url
      }

      console.log(`Sitemap found but no term-date URLs matched`)
      return null // sitemap found but no relevant URLs — no point trying the other path
    } catch (e: any) {
      console.log(`Sitemap not available at ${origin}${path}: ${e?.message}`)
    }
  }
  return null
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
${content}`,
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

// Strip HTML while preserving line structure so Claude can parse date lists correctly.
// Block-level elements become newlines; inline tags become spaces. No-op on clean text.
function cleanForClaude(raw: string): string {
  return raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|td|tr|th|h[1-6]|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')      // trim trailing whitespace from each line
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// When HTML is fetched (vs Jina markdown), navigation menus produce a long preamble before the
// actual dates section. Find where the term dates content begins and discard everything before it.
function findDatesSection(content: string): string {
  if (content.length <= 2500) return content
  const idx = content.search(
    /(?:ACADEMIC YEAR|School\s+Term\s+Dates?|Term\s+Dates?\s*\n|(?:Autumn|Spring|Summer)\s+Term)\s+20\d\d/i
  )
  if (idx > 300) return content.slice(Math.max(0, idx - 80))
  return content
}

// Strip URLs and navigation noise from content.
// We're already on the term dates page, so links/nav are pure noise.
// Bullet list items are kept only if they contain holiday-related keywords
// (some schools format dates as bullets; navigation items never do).
function stripUrls(content: string): string {
  const holidayBullet = /\b(inset\s*day|half.?term|bank\s+holiday|christmas|easter|summer\s+holid|school\s+term\s+dates?|break\s+up|academic\s+year)\b/i
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t) return true
      if (/^\*+$/.test(t)) return false          // bare asterisk(s) — stripped nav icon
      if (/^\*+\s/.test(t)) return holidayBullet.test(t)
      return true
    })
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractTermDates(rawContent: string): Promise<{ termDates: any[], schoolName: string | null }> {
  const today = new Date().toISOString().split('T')[0]
  const cleaned = cleanForClaude(rawContent)
  const stripped = stripUrls(cleaned)
  const content = findDatesSection(stripped)

  console.log(`extractTermDates: raw ${rawContent.length}→cleaned ${cleaned.length}→stripped ${stripped.length}→section ${content.length} chars`)
  console.log('section preview:', content.slice(0, 500))

  const res = await callClaude(
    `Extract all dated events from this UK school term calendar. Include everything: term start/end dates, half terms, holidays, INSET days, bank holidays.

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name": "name of the school or null",
  "events": [
    {
      "title": "descriptive title e.g. Half Term / Christmas Holiday / INSET Day / Spring Term / Autumn Term begins",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null (use for multi-day periods)"
    }
  ]
}

Rules:
- Include ALL dates shown — past, present and future
- For multi-day periods always set end_date
- Use the academic year context to infer the year for any dates missing it
- Holiday inference: if two consecutive terms have no holiday listed between them, infer one:
  • Michaelmas/Autumn term ends → Lent/Spring term begins: infer "Christmas Holiday" (date = day after term end, end_date = day before next term start or INSET day)
  • Lent/Spring term ends → Summer term begins: infer "Easter Holiday" (date = day after term end, end_date = day before next term start or INSET day)
  • Summer term ends → Michaelmas/Autumn term begins: infer "Summer Holiday" (date = day after term end, end_date = day before next term start or INSET day)

Content:
${content.slice(0, 15000)}`,
    4096
  )

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

// Post-merge: infer Summer/Christmas/Easter holidays when they span two separate sources
// (e.g. 2025-26 PDF ends at "Summer Term ends" and 2026-27 PDF starts with INSET days)
function inferMissingHolidays(events: any[]): void {
  const addDays = (d: string, n: number): string => {
    const dt = new Date(`${d}T00:00:00Z`)
    dt.setUTCDate(dt.getUTCDate() + n)
    return dt.toISOString().split('T')[0]
  }
  const sorted = [...events].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const hasHolidayInGap = (afterDate: string, beforeDate: string) =>
    events.some(f => {
      const l = f.title.toLowerCase()
      if (!l.includes('holiday') && !l.includes('half term') && !l.includes('half-term')) return false
      return f.date > afterDate && (f.end_date ?? f.date) < beforeDate
    })

  const defs: Array<[(t: string) => boolean, (t: string) => boolean, string]> = [
    [
      t => /\bsummer\b/i.test(t) && /\b(end|ends|close|closes|last day)\b/i.test(t),
      t => /\b(autumn|michaelmas)\b/i.test(t) || /\binset\b/i.test(t),
      'Summer Holiday',
    ],
    [
      t => /\b(autumn|michaelmas|christmas|winter)\b/i.test(t) && /\b(end|ends|close|closes|last day)\b/i.test(t),
      t => /\b(spring|lent|january)\b/i.test(t) || /\binset\b/i.test(t),
      'Christmas Holiday',
    ],
    [
      t => /\b(spring|lent)\b/i.test(t) && /\b(end|ends|close|closes|last day)\b/i.test(t),
      t => /\bsummer\b/i.test(t) || /\binset\b/i.test(t),
      'Easter Holiday',
    ],
  ]

  for (const [isTermEnd, isNextStart, holidayName] of defs) {
    for (const e of sorted) {
      if (!isTermEnd(e.title)) continue
      const termEnd = e.end_date ?? e.date
      const next = sorted.find(f => f.date > termEnd && isNextStart(f.title))
      if (!next) continue
      if (hasHolidayInGap(termEnd, next.date)) continue
      const hStart = addDays(termEnd, 1)
      const hEnd   = addDays(next.date, -1)
      if (hStart <= hEnd) {
        console.log(`Inferred ${holidayName}: ${hStart} – ${hEnd}`)
        events.push({ title: holidayName, date: hStart, end_date: hEnd })
      }
    }
  }
}

// Returns false for events where school is open (term start/end, parents evenings, sports days etc.)
function isSchoolClosedEvent(title: string): boolean {
  const lc = title.toLowerCase()
  if (/\b(term (starts?|begins?|opens?|returns?|ends?|closes?)|back to school|school (re)?open(s)?)\b/.test(lc)) return false
  if (/\b(pupils? (return|in school|back)|students? (return|back)|all year groups? in school|year \d+ in school)\b/.test(lc)) return false
  if (/\b(parents?' evening|open evening|information evening|sports day|prize giving|graduation|speech day)\b/.test(lc)) return false
  if (/\b(exam(ination)?|assessment|ppe|gcse|a.?level)\b/.test(lc) && !/\b(holiday|break|closed)\b/.test(lc)) return false
  return true
}

// ── Apply to family ───────────────────────────────────────────────────────────

async function applyTermDatesToFamily(familyId: string, termDates: any[], schoolName: string | null): Promise<number> {
  const sourceSubject = schoolName ?? 'School term dates'

  // Clean replace: wipe all existing term dates for this school (and the generic fallback
  // name used when school name wasn't detected) before inserting the fresh extraction.
  // This prevents duplicates when the source_subject name changes between scrape runs.
  for (const subject of [...new Set([sourceSubject, 'School term dates'])]) {
    await supabase.from('family_events')
      .delete()
      .eq('family_id', familyId)
      .eq('source', 'term_dates')
      .eq('source_subject', subject)
  }

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 1)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  console.log(`Applying term dates — cutoff: ${cutoffStr}, sourceSubject: ${sourceSubject}`)

  const afterCutoff = termDates.filter((e: any) => e.date && String(e.date) >= cutoffStr)
  console.log(`Apply: ${termDates.length} KB events → ${afterCutoff.length} after cutoff (${cutoffStr})`)

  let added = 0
  for (const event of termDates) {
    if (!event.date || !event.title) continue
    if (String(event.date) < cutoffStr) continue

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

// ── Scrape failure diagnostics ────────────────────────────────────────────────

async function generateDiagnosis(homepageUrl: string, errorMessage: string, diagnostic: Record<string, any>): Promise<string | null> {
  const lines = [
    `School homepage: ${homepageUrl}`,
    `Error type: ${diagnostic.error_type}`,
    `Error: ${errorMessage}`,
  ]
  if (diagnostic.term_dates_url) lines.push(`Term dates URL attempted: ${diagnostic.term_dates_url}`)
  if (diagnostic.links_found?.length) lines.push(`Links found on homepage (${diagnostic.links_found.length}): ${diagnostic.links_found.slice(0, 10).join(', ')}`)
  if (diagnostic.content_preview) lines.push(`Page content preview:\n${diagnostic.content_preview}`)

  return callClaude(
    `You are analysing why an automated scraper failed to extract UK school term dates.

${lines.join('\n')}

In 2-3 sentences explain: what went wrong, the likely root cause (e.g. homepage too large to scan nav links, server blocking requests, JS-rendered content, cookie wall, PDF-only dates, wrong URL found), and what a developer could try to fix it.`,
    256
  )
}

async function storeDiagnostic(homepageUrl: string, errorMessage: string, diagnostic: Record<string, any>): Promise<void> {
  const diagnosis = await generateDiagnosis(homepageUrl, errorMessage, diagnostic).catch(() => null)
  const { error } = await supabase.from('school_calendars').upsert({
    homepage_url:     homepageUrl,
    scrape_error:     { ...diagnostic, error_message: errorMessage },
    scrape_error_at:  new Date().toISOString(),
    scrape_diagnosis: diagnosis,
  }, { onConflict: 'homepage_url' })
  if (error) console.error('storeDiagnostic upsert failed:', error)
  else console.log(`Diagnostic stored for ${homepageUrl}: ${diagnostic.error_type}`)
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
        model:       'claude-haiku-4-5-20251001',
        max_tokens:  maxTokens,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
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
