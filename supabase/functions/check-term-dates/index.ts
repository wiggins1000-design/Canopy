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
  const webhookToken = Deno.env.get('TERM_DATES_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  const authHeader = req.headers.get('authorization')

  let targetFamilyId: string | null = null

  if (incomingToken && webhookToken && incomingToken === webhookToken) {
    // Cron mode — process all families
  } else if (authHeader?.startsWith('Bearer ')) {
    // Manual trigger — process just the calling user's family
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
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

  // ── Process each unique school ────────────────────────────────────────────
  const forceRefresh = !!targetFamilyId
  const results: any[] = []

  for (const [homepageUrl, familyIds] of Object.entries(urlToFamilies)) {
    console.log(`Processing school: ${homepageUrl} (${familyIds.size} families)`)
    const result = await processSchool(homepageUrl, [...familyIds], forceRefresh)
    results.push({ homepageUrl, ...result })
  }

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

    const ageMs = cached?.last_fetched_at
      ? Date.now() - new Date(cached.last_fetched_at).getTime()
      : Infinity
    const isStale = ageMs > 30 * 24 * 60 * 60 * 1000

    let termDates: any[] = (cached as any)?.term_dates ?? []

    if (!cached || isStale || forceRefresh) {
      const scraped = await scrapeTermDates(homepageUrl, (cached as any)?.content_hash ?? null)

      if (scraped.unchanged) {
        await supabase.from('school_calendars')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('homepage_url', homepageUrl)
        return { status: 'unchanged' }
      }

      if (scraped.error) {
        console.error(`Scrape error for ${homepageUrl}:`, scraped.error)
        return { status: 'error', error: scraped.error }
      }

      if (scraped.termDates?.length) {
        termDates = scraped.termDates
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
      totalAdded += await applyTermDatesToFamily(familyId, termDates)
    }

    return { status: 'ok', eventsAdded: totalAdded }
  } catch (e: any) {
    console.error('processSchool error:', e)
    return { status: 'error', error: e.message }
  }
}

// ── Two-hop scrape ────────────────────────────────────────────────────────────

async function scrapeTermDates(homepageUrl: string, existingHash: string | null) {
  const origin = new URL(homepageUrl).origin

  const homepageContent = await fetchViaJina(homepageUrl)
  if (!homepageContent) return { error: 'Failed to fetch school homepage — the site may be blocking requests' }

  console.log(`Homepage fetched (${homepageContent.length} chars), searching for term dates link…`)

  // First try: ask Claude to find the link from the homepage content
  let termDatesUrl = await findTermDatesUrl(homepageContent, origin)

  // Second try: if Claude couldn't find it, try common UK school website URL patterns
  if (!termDatesUrl) {
    console.log('Claude could not find link, trying common URL patterns…')
    termDatesUrl = await tryCommonPaths(origin)
  }

  // Third try: if the homepage itself looks like it contains term dates, use it directly
  if (!termDatesUrl) {
    const lc = homepageContent.toLowerCase()
    if (lc.includes('term') && (lc.includes('autumn') || lc.includes('spring') || lc.includes('summer') || lc.includes('half-term') || lc.includes('half term'))) {
      console.log('Term dates appear to be on the homepage itself, using directly…')
      termDatesUrl = homepageUrl
    }
  }

  if (!termDatesUrl) return { error: 'Could not find term dates page. Try entering the direct URL of the term dates page instead of the homepage.' }

  console.log(`Term dates page: ${termDatesUrl}`)

  const termDatesContent = termDatesUrl === homepageUrl
    ? homepageContent
    : await fetchViaJina(termDatesUrl)

  if (!termDatesContent) return { error: 'Failed to fetch term dates page' }

  const contentHash = await hashContent(termDatesContent)
  if (contentHash === existingHash) return { unchanged: true }

  // Try extracting dates from the HTML page first
  let { termDates, schoolName } = await extractTermDates(termDatesContent)
  let usedUrl = termDatesUrl

  // If no dates found, look for document links on the page
  if (!termDates.length) {
    // Fetch the page again with Jina's link summary to get every link reliably
    const allLinks = await fetchJinaLinks(termDatesUrl)
    console.log(`No dates in HTML. All links from page: ${JSON.stringify(allLinks)}`)

    // Ask Claude which link is most likely to be the term dates document
    const docLinks = allLinks.length > 0
      ? await findDocumentLinkFromList(allLinks, termDatesUrl)
      : findDocumentLinks(termDatesContent, termDatesUrl)  // fallback: regex on content

    console.log(`Document links to try: ${JSON.stringify(docLinks)}`)

    for (const docUrl of docLinks) {
      const docContent = await fetchViaJina(docUrl)
      if (!docContent) continue
      const result = await extractTermDates(docContent)
      if (result.termDates.length > 0) {
        termDates = result.termDates
        if (result.schoolName) schoolName = result.schoolName
        usedUrl = docUrl
        console.log(`Extracted ${termDates.length} events from document: ${docUrl}`)
        break
      }
    }
  }

  console.log(`Total extracted: ${termDates.length} term date events`)

  if (!termDates.length) return { error: 'Found the term dates page but could not extract dates. If dates are in an image or scanned PDF they cannot be read automatically.' }

  return { termDatesUrl: usedUrl, termDates, contentHash, schoolName }
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      console.error(`Jina returned ${res.status} for ${url}`)
      return null
    }
    const text = await res.text()
    console.log(`Jina fetched ${url}: ${text.length} chars`)
    return text.slice(0, 15000)
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
        'Accept': 'text/plain',
        'X-With-Links-Summary': 'all',
      },
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) return []
    const text = await res.text()
    // Jina appends a links section at the bottom: "Links/Buttons:\n- [text]: url\n..."
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

// Ask Claude to pick the most likely term-dates document from a list of links
async function findDocumentLinkFromList(links: string[], pageUrl: string): Promise<string[]> {
  const res = await callClaude(
    `Here are all the links found on a school term dates page (${pageUrl}).
Identify any links that are likely to be a term dates document (PDF, Word doc, spreadsheet, Google Drive, OneDrive, SharePoint, or similar).
Return ONLY a JSON array of URLs — the most relevant first, maximum 3. If none are relevant, return [].

Links:
${links.join('\n')}`,
    512
  )
  if (!res) return []
  try {
    const parsed = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return Array.isArray(parsed) ? parsed.filter((u: any) => typeof u === 'string') : []
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
  const url = res.trim().replace(/^["']|["']$/g, '') // strip any accidental quotes
  if (!url || url === 'null' || url.length > 500) return null

  if (url.startsWith('http')) return url
  if (url.startsWith('/')) return `${origin}${url}`

  try { return new URL(url, origin).href } catch { return null }
}

// Common URL patterns used by UK school website platforms (SchoolJotter, Arbor, Arbor, Schudio, etc.)
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

  for (const path of paths) {
    try {
      const url = `${origin}${path}`
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        console.log(`Found via common path: ${url}`)
        return url
      }
    } catch { /* ignore */ }
  }
  return null
}

// Extract PDF, .doc, .docx links from Jina markdown output or raw HTML
function findDocumentLinks(content: string, pageUrl: string): string[] {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  const found = new Set<string>()

  // Markdown links: [text](url)
  const mdPattern = /\[([^\]]*)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdPattern.exec(content)) !== null) {
    const url = m[2].trim()
    if (/\.(pdf|docx?)(\?[^)\s]*)?$/i.test(url)) {
      found.add(url.startsWith('http') ? url : url.startsWith('/') ? `${origin}${url}` : url)
    }
  }

  // Raw URLs anywhere in the text
  const rawPattern = /https?:\/\/[^\s"'<>)]+\.(?:pdf|docx?)(?:\?[^\s"'<>)]*)?/gi
  while ((m = rawPattern.exec(content)) !== null) {
    found.add(m[0])
  }

  // Relative paths that look like document links
  const relPattern = /(?:\/[^\s"'<>()]+\.(?:pdf|docx?)(?:\?[^\s"'<>)]*)?)/gi
  while ((m = relPattern.exec(content)) !== null) {
    if (origin) found.add(`${origin}${m[0]}`)
  }

  return [...found].slice(0, 5)
}

async function extractTermDates(content: string): Promise<{ termDates: any[], schoolName: string | null }> {
  const today = new Date().toISOString().split('T')[0]
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - 1)
  const cutoff = cutoffDate.toISOString().split('T')[0]

  const res = await callClaude(
    `Extract all UK school term dates from this content. Today is ${today}. Ignore dates before ${cutoff}.

The content may come from a webpage, PDF, or Word document. Dates may be in tables, lists, or paragraphs.
Common formats: "Monday 4 September", "4th September 2024", "04/09/2024", "September 4".

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name": "name of the school or null",
  "events": [
    {
      "title": "clear title e.g. Autumn Term Starts / Half Term Holiday / Christmas Holiday / Easter Holiday / Summer Holiday / INSET Day / Term Ends",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null (use for multi-day holidays and half terms)"
    }
  ]
}

Rules:
- Include: term start/end dates, half-term holidays, all school holidays, INSET days
- For holiday periods always include end_date
- Include dates up to 18 months from today, using the document's year context to resolve ambiguous years
- If a table has columns like "Term | Start | End", create two events: "X Term Starts" and "X Term Ends"
- INSET days: schools are closed, parents should know

Content:
${content}`,
    2048
  )

  if (!res) return { termDates: [], schoolName: null }

  try {
    const json = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return { termDates: json.events ?? [], schoolName: json.school_name ?? null }
  } catch (e) {
    console.error('Failed to parse Claude term dates response:', e)
    return { termDates: [], schoolName: null }
  }
}

// ── Apply to family ───────────────────────────────────────────────────────────

async function applyTermDatesToFamily(familyId: string, termDates: any[]): Promise<number> {
  const { data: existing } = await supabase
    .from('family_events')
    .select('title, event_date')
    .eq('family_id', familyId)
    .eq('source', 'term_dates')

  const existingKeys = new Set((existing ?? []).map((e: any) => `${e.title}||${e.event_date}`))

  let added = 0
  for (const event of termDates) {
    if (!event.date || !event.title) continue
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

    if (error) {
      console.error('create_family_event error:', error)
    } else {
      added++
    }
  }

  return added
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return `${u.protocol}//${u.hostname}`.toLowerCase()
  } catch {
    return url.toLowerCase().replace(/\/$/, '')
  }
}

async function hashContent(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content)
  const buf = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function callClaude(prompt: string, maxTokens: number): Promise<string | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:    'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    console.error('Claude error:', await res.text())
    return null
  }
  const data = await res.json()
  return data.content?.[0]?.text ?? null
}
