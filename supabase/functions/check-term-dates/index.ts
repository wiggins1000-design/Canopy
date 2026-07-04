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
import { getLocaleConfig, getLocaleFromUrl, CLAUDE_EXTRACTION_PROMPTS } from '../_shared/localeConfig.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Schools are processed in bounded batches rather than all at once — each school can now
// hold up to 200k chars of fetched text or a 30MB PDF in memory (native PDF extraction +
// raised content caps), and running 50 in parallel exceeded the edge function's worker
// memory limit (HTTP 546). Applies to both test mode and the production cron/manual paths.
const SCHOOL_BATCH_SIZE = 6

async function processInBatches<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    results.push(...await Promise.all(batch.map(fn)))
  }
  return results
}

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

  // ── Test mode: process arbitrary URLs without family data ─────────────────
  // Only available when authenticated via webhook token (admin only).
  // Body: { test_urls: ["https://...", ...] }
  const isCronOrWebhook = incomingToken && webhookToken && incomingToken === webhookToken
  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }

  if (body?.test_urls?.length && isCronOrWebhook) {
    const testUrls: string[] = (body.test_urls as string[]).map(normalizeUrl)
    const testLocale: string | undefined = body.locale  // optional locale override for US schools
    console.log(`Test mode: processing ${testUrls.length} URLs${testLocale ? ` (locale: ${testLocale})` : ''}`)
    const results = await processInBatches(testUrls, SCHOOL_BATCH_SIZE, async (url) => {
      console.log(`Test-processing: ${url}`)
      const result = await processSchool(url, [], true, testLocale)
        .catch((e: any) => ({ status: 'error', error: e?.message ?? 'Unknown error' }))
      return { url, ...result }
    })
    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Manual scrape: override term dates URL for a specific school ────────────
  // Scrapes term_dates_url directly but stores the result under homepage_url,
  // so families already linked to that school get the corrected dates.
  // Body: { manual_scrape: { homepage_url: "https://...", term_dates_url: "https://..." } }
  if (body?.manual_scrape && isCronOrWebhook) {
    const { homepage_url, term_dates_url } = body.manual_scrape as { homepage_url: string; term_dates_url: string }
    const manualLocale = getLocaleFromUrl(homepage_url) ?? 'en-GB'
    console.log(`Manual scrape: ${homepage_url} → ${term_dates_url} (locale: ${manualLocale})`)
    const scraped = await scrapeTermDates(term_dates_url, null)
    if (scraped.error) {
      if ((scraped as any).diagnostic) {
        await storeDiagnostic(homepage_url, scraped.error, (scraped as any).diagnostic, manualLocale)
      }
      return new Response(JSON.stringify({ ok: false, error: scraped.error, diagnostic: (scraped as any).diagnostic }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    await supabase.from('school_calendars').upsert({
      homepage_url,
      term_dates_url:   scraped.termDatesUrl ?? term_dates_url,
      school_name:      scraped.schoolName,
      term_dates:       scraped.termDates,
      content_hash:     scraped.contentHash,
      last_fetched_at:  new Date().toISOString(),
      locale:           manualLocale,
      scrape_error:     null,
      scrape_error_at:  null,
      scrape_diagnosis: null,
    }, { onConflict: 'homepage_url' })
    return new Response(JSON.stringify({ ok: true, termDatesCount: scraped.termDates?.length, schoolName: scraped.schoolName }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
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
  const isCronRun = !targetFamilyId
  if (isCronRun) {
    const { error: archiveErr } = await supabase.rpc('archive_old_notifications')
    if (archiveErr) console.error('archive_old_notifications error:', archiveErr)
    else console.log('archive_old_notifications: done')

    const { error: trimErr } = await supabase.rpc('trim_old_term_dates')
    if (trimErr) console.error('trim_old_term_dates error:', trimErr)
    else console.log('trim_old_term_dates: done')
  }

  // ── Process all schools in parallel ──────────────────────────────────────
  // Cron used to force a full re-scrape + re-extraction of every school every month
  // regardless of cache freshness (forceRefresh=true also nulled out the content-hash
  // check, so even byte-identical pages re-ran the full Claude pipeline). That cost
  // scales with total schools in the system for no benefit - term dates don't change
  // month to month. Cron now respects the same 30-day staleness + unchanged-hash
  // short-circuit as an on-demand family sync; only genuinely stale/new/changed
  // schools actually hit Claude.

  const results = await processInBatches(Object.entries(urlToFamilies), SCHOOL_BATCH_SIZE, async ([homepageUrl, familyIds]) => {
    console.log(`Processing school: ${homepageUrl} (${familyIds.size} families)`)
    const result = await processSchool(homepageUrl, [...familyIds], false)
      .catch((e: any) => ({ status: 'error', error: e?.message ?? 'Unknown error' }))
    return { homepageUrl, ...result }
  })

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

// ── Core processing ───────────────────────────────────────────────────────────

async function processSchool(homepageUrl: string, familyIds: string[], forceRefresh: boolean, localeOverride?: string) {
  // Derive locale from URL TLD; fall back to first family's stored locale
  let locale = localeOverride ?? getLocaleFromUrl(homepageUrl) ?? 'en-GB'
  if (!localeOverride && locale === 'en-GB' && familyIds.length > 0) {
    const { data: fam } = await supabase
      .from('families')
      .select('config')
      .eq('id', familyIds[0])
      .maybeSingle()
    if (fam && (fam as any).config?.locale) {
      locale = (fam as any).config.locale
    }
  }

  try {
    const { data: cached } = await supabase
      .from('school_calendars')
      .select('*')
      .eq('homepage_url', homepageUrl)
      .maybeSingle()

    const ageMs   = cached?.last_fetched_at
      ? Date.now() - new Date(cached.last_fetched_at).getTime()
      : Infinity
    // Also re-scrape if the cache exists but has no dates (previous scrape failed silently).
    // 60 days rather than 30: term dates are typically published a year ahead and rarely
    // change, and any sync (manual or cron) that actually scrapes a school resets
    // last_fetched_at, so a family syncing recently naturally skips the next cron pass.
    const isStale = ageMs > 60 * 24 * 60 * 60 * 1000 || !((cached as any)?.term_dates?.length)

    let termDates: any[] = (cached as any)?.term_dates ?? []
    let resolvedSchoolName: string | null = (cached as any)?.school_name ?? null

    if (!cached || isStale || forceRefresh) {
      const existingHash = forceRefresh ? null : ((cached as any)?.content_hash ?? null)
      const scraped = await scrapeTermDates(homepageUrl, existingHash, locale)

      if (scraped.unchanged) {
        await supabase.from('school_calendars')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('homepage_url', homepageUrl)
      }

      if (scraped.error) {
        console.error(`Scrape error for ${homepageUrl}:`, scraped.error)
        if ((scraped as any).diagnostic) {
          await storeDiagnostic(homepageUrl, scraped.error, (scraped as any).diagnostic, locale)
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
          locale,
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

async function scrapeTermDates(homepageUrl: string, existingHash: string | null, locale: string) {
  const urlObj  = new URL(homepageUrl)
  const origin  = urlObj.origin
  const isDirectUrl = urlObj.pathname.length > 1 || urlObj.search.length > 0

  // ── Discovery: build initial ordered candidate list ───────────────────────
  // High-confidence methods (sitemap, pattern match, common paths) each produce one URL.
  // homepageContent and links are hoisted so the extraction loop can lazily expand
  // with Claude fallbacks if all initial candidates fail extraction.
  let candidates: string[] = []
  let linksForDiagnostic: string[] = []
  let homepageContentForFallback: string | null = null
  let linksForFallback: string[] = []

  if (isDirectUrl) {
    console.log(`Using direct term dates URL: ${homepageUrl}`)
    candidates = [homepageUrl]
  } else {
    // Try 1: sitemap.xml — single request, no homepage fetch needed
    const sitemapUrl = await fetchSitemapTermDatesUrl(origin)
    if (sitemapUrl) {
      candidates.push(sitemapUrl)
    } else {
      // Fetch homepage via reader (relaxed check — any real page, not just calendar pages)
      const homepageContent = await fetchHomepage(homepageUrl)
      if (!homepageContent) return { error: 'Failed to fetch school homepage — the site may be blocking requests', diagnostic: { error_type: 'homepage_fetch_failed' } }

      console.log(`Homepage fetched (${homepageContent.length} chars), searching for term dates link…`)
      homepageContentForFallback = homepageContent

      // Try 2: extract links — recover nav links from raw HTML when content is plaintext
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
      linksForDiagnostic = links
      linksForFallback = links

      // Try 3: pattern match (high confidence — URL literally contains term-dates etc.)
      const patternMatch = findTermDatesLinkByPattern(links)
      if (patternMatch) {
        candidates.push(patternMatch)
      } else {
        // Try 4: common URL patterns for this locale — fast HEAD checks, no Claude needed.
        // Run before Claude because large homepages (1MB+) often exceed the raw HTML
        // fetch cap, leaving nav links missing and Claude with irrelevant links to guess from.
        console.log('Pattern match failed, trying common URL patterns…')
        const commonPath = await tryCommonPaths(origin, locale)
        if (commonPath) candidates.push(commonPath)
      }

      // When high-confidence methods failed upfront, ask Claude immediately so
      // candidates has multiple options from the start.
      if (candidates.length === 0) {
        console.log('No high-confidence URL found, asking Claude for ranked candidates…')
        const [claudePicks, contentPick] = await Promise.all([
          links.length > 0 ? pickTermDatesLinks(links, origin, locale) : Promise.resolve([]),
          findTermDatesUrl(homepageContent, origin, locale),
        ])
        for (const p of claudePicks) if (!candidates.includes(p)) candidates.push(p)
        if (contentPick && !candidates.includes(contentPick)) candidates.push(contentPick)
      }

      // Homepage as absolute last resort (inline dates) — locale-aware check
      if (getLocaleConfig(locale).termDateRegex.test(homepageContent)) {
        if (!candidates.includes(homepageUrl)) candidates.push(homepageUrl)
      }
    }

    if (candidates.length === 0) {
      return { error: 'Could not find term dates page on this school\'s website.', diagnostic: { error_type: 'discovery_failed', links_found: linksForDiagnostic.slice(0, 30) } }
    }
  }

  console.log(`Initial candidates (${candidates.length}): ${candidates.join(' | ')}`)

  // ── Extraction: try each candidate; lazily expand with Claude if all fail ──
  // Candidates is mutated during iteration — JS for-of sees newly pushed items,
  // so the lazy expansion below simply appends to the same array.
  const triedUrls: string[] = []
  let claudeFallbacksAdded = false
  let lastContentPreview = ''

  for (const candidateUrl of candidates) {
    console.log(`Trying candidate: ${candidateUrl}`)
    triedUrls.push(candidateUrl)

    // Candidate page is itself a PDF — read it natively via Claude's document API
    // rather than routing through the HTML text pipeline (which can't handle scanned pages).
    if (isPdfUrl(candidateUrl)) {
      console.log(`Candidate is a PDF, extracting via Claude document API: ${candidateUrl}`)
      const pdfResult = await extractTermDatesFromPdf(candidateUrl, locale)
      if (!pdfResult.pdfBase64) {
        console.log(`Could not fetch PDF ${candidateUrl} — trying next candidate…`)
        continue
      }
      const contentHash = await hashContent(pdfResult.pdfBase64)
      if (contentHash === existingHash) return { unchanged: true }

      let termDates = pdfResult.termDates
      inferMissingHolidays(termDates, locale)
      termDates = termDates.filter((e: any) => e.title && isSchoolClosedEvent(e.title, locale))
      termDates = deduplicateOverlapping(termDates)
      console.log(`Total events for KB from PDF ${candidateUrl}: ${termDates.length}`)

      if (termDates.length > 0) {
        return { termDatesUrl: candidateUrl, termDates, contentHash, schoolName: pdfResult.schoolName }
      }
      console.log(`No dates from PDF ${candidateUrl} — trying next candidate…`)
      continue
    }

    const termDatesContent = await fetchPage(candidateUrl, locale)
    console.log(`Content length: ${termDatesContent?.length ?? 0}`)

    if (!termDatesContent) {
      console.log(`No content from ${candidateUrl} — skipping`)
    } else {
      lastContentPreview = termDatesContent.slice(0, 600)
      console.log(`Content preview: ${termDatesContent.slice(0, 300)}`)

      const contentHash = await hashContent(termDatesContent)
      if (contentHash === existingHash) return { unchanged: true }

      // Fetch raw HTML separately to extract PDF/document attachment links via regex.
      // Jina strips <a href> attachment elements from its markdown, and fetchDirect caps at 30k
      // which may not reach the attachment section on large pages (e.g. Cherry Orchard: 57k HTML,
      // attachments at ~45k). A direct uncapped fetch + regex is fast and doesn't need Claude.
      const rawHtmlForDocs = await fetch(candidateUrl, { signal: AbortSignal.timeout(10000) })
        .then(r => r.text()).catch(() => null)
      const rawHtmlDocLinks = rawHtmlForDocs ? extractDocLinksFromHtml(rawHtmlForDocs, candidateUrl) : []
      if (rawHtmlDocLinks.length > 0) console.log(`Raw HTML doc links: ${JSON.stringify(rawHtmlDocLinks)}`)

      const [htmlResult, docLinks] = await Promise.all([
        extractTermDates(termDatesContent, locale),
        findDocumentLinksViaClaude(termDatesContent, candidateUrl, locale),
      ])
      let { termDates, schoolName } = htmlResult
      console.log(`Extracted ${termDates.length} events from HTML at ${candidateUrl}`)
      console.log(`Document links found by Claude: ${JSON.stringify(docLinks)}`)

      // Fetch all PDFs in parallel and merge any new dates
      const uniqueDocLinks = [...new Set([...rawHtmlDocLinks, ...(docLinks as string[])])]
      if (uniqueDocLinks.length > 0) {
        const pdfResults = await Promise.all(
          uniqueDocLinks.map(async (docUrl: string) => {
            if (isPdfUrl(docUrl)) {
              const result = await extractTermDatesFromPdf(docUrl, locale)
              return { termDates: result.termDates, schoolName: result.schoolName, url: docUrl }
            }
            const docContent = await fetchPage(docUrl, locale)
            if (!docContent) return { termDates: [], schoolName: null, url: docUrl }
            const result = await extractTermDates(docContent, locale)
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

      inferMissingHolidays(termDates, locale)

      // Filter to school-closed events before saving to KB — removes term start/end
      // dates, pupils return days etc. so the KB only contains calendar-worthy events.
      // inferMissingHolidays must run first as it needs term-end events to find gaps.
      termDates = termDates.filter((e: any) => e.title && isSchoolClosedEvent(e.title, locale))
      termDates = deduplicateOverlapping(termDates)
      console.log(`Total events for KB from ${candidateUrl}: ${termDates.length}`)

      if (termDates.length > 0) {
        return { termDatesUrl: candidateUrl, termDates, contentHash, schoolName }
      }

      console.log(`No dates from ${candidateUrl} — trying next candidate…`)
    }

    // Lazy Claude expansion: when initial candidates are exhausted and extraction
    // has not succeeded, ask Claude for additional fallback URLs. Only runs once.
    // Appending to candidates mid-loop is safe — JS for-of sees new items.
    // If we never fetched the homepage (sitemap fast-path), fetch it lazily here.
    if (!claudeFallbacksAdded && triedUrls.length >= candidates.length && !isDirectUrl) {
      claudeFallbacksAdded = true
      if (!homepageContentForFallback) {
        console.log('Fetching homepage for lazy Claude fallback (came from sitemap fast-path)…')
        homepageContentForFallback = await fetchHomepage(homepageUrl)
        if (homepageContentForFallback) {
          linksForFallback = extractLinksFromContent(homepageContentForFallback, origin)
          if (!homepageContentForFallback.includes('href=')) {
            const rawHtml = await fetchDirect(homepageUrl)
            if (rawHtml) linksForFallback = [...new Set([...linksForFallback, ...extractLinksFromContent(rawHtml, origin)])]
          }
        }
      }
      if (homepageContentForFallback) {
        console.log('Initial candidates exhausted, asking Claude for additional fallbacks…')
        const [claudePicks, contentPick] = await Promise.all([
          linksForFallback.length > 0 ? pickTermDatesLinks(linksForFallback, origin, locale) : Promise.resolve([]),
          findTermDatesUrl(homepageContentForFallback, origin, locale),
        ])
        const newCandidates = [...claudePicks, contentPick].filter((p): p is string => !!p && !candidates.includes(p))
        if (newCandidates.length > 0) {
          console.log(`Claude fallbacks added: ${newCandidates.join(' | ')}`)
          candidates.push(...newCandidates)
        }
      }
    }
  }

  return {
    error: 'Found the term dates page but could not extract dates. If dates are in an image or scanned PDF they cannot be read automatically.',
    diagnostic: { error_type: 'extraction_failed', candidates_tried: triedUrls, content_preview: lastContentPreview },
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// Fetch homepage — relaxed content check (just needs to be a real page, not bot-blocked).
// Used for the first hop so school homepages without calendar keywords aren't rejected.
async function fetchHomepage(url: string): Promise<string | null> {
  return fetchPageWithCheck(url, isRealPage)
}

// Fetch term dates page — strict check requires calendar-relevant keywords (locale-aware).
async function fetchPage(url: string, locale: string): Promise<string | null> {
  return fetchPageWithCheck(url, (t) => looksLikeUsefulContent(t, locale))
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
    // 200k covers large component-framework pages (tabbed academic-year pickers etc.)
    // where the dates table sits well past the old 60k cap. findDatesSection trims
    // this down to the relevant section before it ever reaches Claude.
    return text.slice(0, 200000)
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

// Term dates page — must contain calendar-relevant keywords (locale-aware)
function looksLikeUsefulContent(text: string, locale: string): boolean {
  if (text.length < 200) return false
  const lc = text.toLowerCase()
  const keywords = getLocaleConfig(locale).contentKeywords
  if (lc.includes('<noscript>') && !keywords.some(k => lc.includes(k))) return false
  // Reject Jina-proxied 404 pages — Jina returns 200 with this warning in the body
  if (lc.includes('target url returned error 404')) return false
  // Reject cookie consent walls — keywords appear only in meta/title, not actual content
  if ((lc.includes('we value your privacy') || lc.includes('cookie consent') ||
       (lc.includes('accept all') && lc.includes('reject all'))) &&
      !(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text))) return false
  return keywords.some(k => lc.includes(k))
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
    // Raised from 30k, but kept more conservative than the direct-fetch cap since
    // Jina is a third-party API that may bill by content processed.
    return text.slice(0, 100000)
  } catch (e) {
    console.error(`Jina fetch failed for ${url}:`, e)
    return null
  }
}

async function findTermDatesUrl(homepageContent: string, origin: string, locale: string): Promise<string | null> {
  const cfg = getLocaleConfig(locale)
  const schoolType = cfg.schoolTypeLabel
  const urlHints = cfg.urlKeywords.map(k => `"${k}"`).join(', ')
  const res = await callClaude(
    `Find the term dates or school calendar page URL on this ${schoolType} website.

School website origin: ${origin}

Homepage content (may be truncated):
${homepageContent}

Look for navigation links, menu items or page links related to:
${urlHints}, "Key Dates", "Dates & Deadlines", "Key Information", "Parents > Calendar"

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
  // Reject event pages with date slugs (e.g. /calendar/2026-07-22/event-name/ or /YYYY/MM/DD/)
  const isEventSlug = (d: string) => /\/\d{4}-\d{2}-\d{2}\//.test(d) || /\/\d{4}\/\d{2}\/\d{2}\//.test(d)
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
    const match = links.find(l => { const d = decode(l); return !isEventSlug(d) && tiers[i](d) })
    if (match) return match
  }
  return null
}

// Returns up to 3 candidate URLs ranked by likelihood, so the extraction loop
// can fall back to the second or third pick if the first yields no dates.
async function pickTermDatesLinks(links: string[], origin: string, locale: string): Promise<string[]> {
  const cfg = getLocaleConfig(locale)
  const schoolType = cfg.schoolTypeLabel
  const urlHints = cfg.urlKeywords.join(', ')
  const res = await callClaude(
    `From this list of URLs from a ${schoolType} website (${origin}), return the URLs most likely to be the term dates, school calendar, or holiday dates page.

Include URLs containing: ${urlHints}, key-dates, holiday-dates, school-dates, calendar.
Exclude URLs that are clearly news articles, blog posts (paths like /news/, /blog/, /YYYY/MM/), policy pages, newsletters, or announcements about individual events.

Return ONLY a JSON array of up to 3 URLs in order of likelihood. Return [] if none are relevant. No explanation.

URLs:
${links.slice(0, 40).join('\n')}`,
    256
  )
  if (!res) return []
  try {
    const parsed = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((u: any) => typeof u === 'string' && !u.includes(' ') && u.length < 300)
      .map((u: string) => {
        if (u.startsWith('http')) return u
        if (u.startsWith('/')) return `${origin}${u}`
        try { return new URL(u, origin).href } catch { return null }
      })
      .filter(Boolean)
      .slice(0, 3) as string[]
  } catch { return [] }
}

async function tryCommonPaths(origin: string, locale: string): Promise<string | null> {
  // Start with locale-specific paths from config, then append universal fallbacks
  const localePaths = getLocaleConfig(locale).commonPaths
  const universalPaths = [
    '/term-dates', '/term-dates/', '/term_dates', '/termdates',
    '/parents/term-dates', '/parents-and-carers/term-dates',
    '/key-information/term-dates', '/school-information/term-dates',
    '/about/term-dates', '/about-us/term-dates',
    '/calendar', '/school-calendar', '/academic-calendar',
    '/parents/calendar', '/key-information/calendar',
    '/term-times', '/parents/term-times',
    '/holiday-dates', '/school-dates',
    '/district-calendar', '/school-year-calendar', '/important-dates',
    '/school-year', '/about/calendar', '/resources/calendar',
    '/school-terms', '/key-dates', '/school-info/term-dates',
  ]
  const paths = [...new Set([...localePaths, ...universalPaths])]

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
    // Reject event pages with date slugs (e.g. /calendar/2026-07-22/event-name/)
    if (/\/\d{4}-\d{2}-\d{2}\//.test(d))                 return 0
    if (/\/\d{4}\/\d{2}\/\d{2}\//.test(d))               return 0
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

// Extract PDF/document download links directly from raw HTML via regex.
// Handles .pdf extensions and query-param patterns like ?file=N&type=pdf (Juniper CMS etc).
// Decodes &amp; HTML entities in href attributes.
function extractDocLinksFromHtml(html: string, pageUrl: string): string[] {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  const matches = [...html.matchAll(/href="([^"]*(?:\.pdf|type=pdf|amp;type=pdf|\.docx?)[^"]*)"/gi)]
  return [...new Set(matches.map(m => {
    const href = m[1].replace(/&amp;/g, '&')
    return href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`
  }))].slice(0, 10)
}

async function findDocumentLinksViaClaude(content: string, pageUrl: string, locale: string): Promise<string[]> {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  const cfg = getLocaleConfig(locale)
  const res = await callClaude(
    `Find links to downloadable documents (PDFs, Word files, spreadsheets) on this school webpage that contain term dates, school holidays, or academic calendars — i.e. when the school is open or closed.

Include documents labelled: term dates, school calendar, academic calendar, holiday dates, school dates, key dates, term times.
Exclude documents that are ONLY about: exam timetables, ${cfg.docExcludeTerms}.

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
function findDatesSection(content: string, locale: string): string {
  if (content.length <= 2500) return content
  const idx = content.search(getLocaleConfig(locale).sectionHeadingRegex)
  if (idx > 300) return content.slice(Math.max(0, idx - 80))
  return content
}

// Strip URLs and navigation noise from content.
// We're already on the term dates page, so links/nav are pure noise.
// Bullet list items are kept only if they contain holiday-related keywords
// (some schools format dates as bullets; navigation items never do).
function stripUrls(content: string, locale: string): string {
  const holidayBullet = getLocaleConfig(locale).bulletFilter
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

async function extractTermDates(rawContent: string, locale: string): Promise<{ termDates: any[], schoolName: string | null }> {
  const cleaned = cleanForClaude(rawContent)
  const stripped = stripUrls(cleaned, locale)
  const content = findDatesSection(stripped, locale)

  console.log(`extractTermDates: raw ${rawContent.length}→cleaned ${cleaned.length}→stripped ${stripped.length}→section ${content.length} chars`)
  console.log('section preview:', content.slice(0, 500))

  const variant = getLocaleConfig(locale).claudeVariant
  const systemPrompt = CLAUDE_EXTRACTION_PROMPTS[variant]

  const res = await callClaude(
    `${systemPrompt}

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name": "name of the school or null",
  "events": [
    {
      "title": "descriptive title",
      "date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null (use for multi-day periods)"
    }
  ]
}

Additional rules:
- Include ALL dates shown — past, present and future
- For multi-day periods always set end_date
- Use the academic year context to infer the year for any dates missing it

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

function isPdfUrl(url: string): boolean {
  const u = url.toLowerCase()
  return u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('type=pdf')
}

// Fetch a PDF's raw bytes and base64-encode for Claude's document API.
// Claude's PDF support handles scanned/image pages via vision — this replaces the
// old Jina-text-extraction path, which returned nothing for image-only PDFs.
async function fetchPdfBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Canopy/1.0; +https://canopy.app)' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    if (!res.ok) { console.log(`PDF fetch returned ${res.status} for ${url}`); return null }
    const buf = new Uint8Array(await res.arrayBuffer())
    // Claude's document API allows up to 32MB, but a genuine term-dates PDF is a handful
    // of pages — a few hundred KB to a couple of MB. Anything past 8MB is almost certainly
    // not a term-dates document, and was the main driver of peak memory when several
    // schools' PDFs were processed concurrently in one batch.
    if (buf.byteLength > 8 * 1024 * 1024) { console.log(`PDF too large (${buf.byteLength} bytes) for ${url}, skipping`); return null }
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < buf.length; i += chunkSize) binary += String.fromCharCode(...buf.subarray(i, i + chunkSize))
    return btoa(binary)
  } catch (e) {
    console.error(`fetchPdfBase64 failed for ${url}:`, e)
    return null
  }
}

async function extractTermDatesFromPdf(pdfUrl: string, locale: string): Promise<{ termDates: any[], schoolName: string | null, pdfBase64: string | null }> {
  const pdfBase64 = await fetchPdfBase64(pdfUrl)
  if (!pdfBase64) return { termDates: [], schoolName: null, pdfBase64: null }

  const variant = getLocaleConfig(locale).claudeVariant
  const systemPrompt = CLAUDE_EXTRACTION_PROMPTS[variant]

  const res = await callClaudeWithDocument(
    `${systemPrompt}

This is a PDF — it may be a native text document or a scanned/photographed page. Read any dates visible anywhere in the document, including tables, calendars and images, not just selectable text.

Return ONLY valid JSON — no markdown, no explanation:
{
  "school_name": "name of the school or null",
  "events": [
    { "title": "descriptive title", "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null (use for multi-day periods)" }
  ]
}

Additional rules:
- Include ALL dates shown — past, present and future
- For multi-day periods always set end_date
- Use the academic year context to infer the year for any dates missing it`,
    pdfBase64,
    4096
  )

  console.log('Claude PDF raw response:', res)
  if (!res) return { termDates: [], schoolName: null, pdfBase64 }

  try {
    const json = JSON.parse(res.replace(/```json\n?|\n?```/g, '').trim())
    return { termDates: json.events ?? [], schoolName: json.school_name ?? null, pdfBase64 }
  } catch (e) {
    console.error('Failed to parse Claude PDF term dates response:', e)
    console.error('Raw response was:', res)
    return { termDates: [], schoolName: null, pdfBase64 }
  }
}

// Post-merge: infer holidays that span the gap between two term-end/term-start events.
// UK: infers Summer/Christmas/Easter from Autumn/Spring/Summer term labels.
// AU:  infers Term 1–4 Holidays from Term N end → Term N+1 start.
// US:  infers Winter/Summer Break from Fall/Spring semester labels.
// IE:  infers Christmas/Easter/Summer from Autumn/Spring/Summer term labels.
function inferMissingHolidays(events: any[], locale: string): void {
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

  // isTermEnd: matches explicit "ends/closes/last day" phrasing AND plain term period titles
  // like "Summer Term 2" — for period events, end_date is already used as termEnd.
  // isNextStart: broadened to include "school opens", "pupils/children return" which are
  // common autumn-term-start phrasings that don't mention "autumn" or "inset" explicitly.
  const returnsOrOpens = (t: string) =>
    /\b(school (re)?opens?|pupils? (return|back)|children (return|back)|back to school)\b/i.test(t)
  const endsOrCloses = (t: string) => /\b(end|ends|close|closes|last day)\b/i.test(t)
  const isPeriodTitle = (t: string) => !endsOrCloses(t) && !/\b(start|begin|open|half.?term|holiday|break|return|back)\b/i.test(t)

  type Def = [(t: string) => boolean, (t: string) => boolean, string]
  let defs: Def[]

  if (locale === 'en-AU' || locale === 'en-NZ') {
    // NZ also uses Term 1-4 naming, same inference pattern as AU
    defs = [
      [t => /\bterm\s+1\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bterm\s+2\b/i.test(t) || returnsOrOpens(t), 'Term 1 Holiday'],
      [t => /\bterm\s+2\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bterm\s+3\b/i.test(t) || returnsOrOpens(t), 'Term 2 Holiday'],
      [t => /\bterm\s+3\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bterm\s+4\b/i.test(t) || returnsOrOpens(t), 'Term 3 Holiday'],
      [t => /\bterm\s+4\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bterm\s+1\b/i.test(t) || returnsOrOpens(t), 'Summer Holiday'],
    ]
  } else if (locale === 'en-US') {
    defs = [
      [t => /\bfall\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\b(spring|second\s+semester)\b/i.test(t) || returnsOrOpens(t), 'Winter Break'],
      [t => /\b(spring|second\s+semester)\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bfall\b/i.test(t) || returnsOrOpens(t), 'Summer Break'],
    ]
  } else if (locale === 'en-IE') {
    defs = [
      [t => /\bsummer\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bautumn\b/i.test(t) || /\bin.?service/i.test(t) || returnsOrOpens(t), 'Summer Holiday'],
      [t => /\b(autumn|christmas|winter)\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\b(spring|january)\b/i.test(t) || /\bin.?service/i.test(t) || returnsOrOpens(t), 'Christmas Holiday'],
      [t => /\bspring\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bsummer\b/i.test(t) || /\bin.?service/i.test(t) || returnsOrOpens(t), 'Easter Holiday'],
    ]
  } else {
    // en-GB — original behavior unchanged
    defs = [
      [t => /\bsummer\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\b(autumn|michaelmas)\b/i.test(t) || /\binset\b/i.test(t) || returnsOrOpens(t), 'Summer Holiday'],
      [t => /\b(autumn|michaelmas|christmas|winter)\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\b(spring|lent|january)\b/i.test(t) || /\binset\b/i.test(t) || returnsOrOpens(t), 'Christmas Holiday'],
      [t => /\b(spring|lent)\b/i.test(t) && (endsOrCloses(t) || isPeriodTitle(t)), t => /\bsummer\b/i.test(t) || /\binset\b/i.test(t) || returnsOrOpens(t), 'Easter Holiday'],
    ]
  }

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

// Removes duplicate/overlapping events, keeping the longest-spanning version.
// Handles cases where two PDFs or extraction passes name the same period differently
// (e.g. "Half Term" and "Autumn Half Term" both starting on the same date).
function deduplicateOverlapping(events: any[]): any[] {
  const endOf = (e: any): string => e.end_date ?? e.date
  const sorted = [...events].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const kept: any[] = []

  for (const candidate of sorted) {
    const cStart = candidate.date
    const cEnd   = endOf(candidate)

    // Check if this candidate is fully contained within an already-kept event
    const absorbed = kept.some(k => k.date <= cStart && endOf(k) >= cEnd)
    if (absorbed) {
      console.log(`Dedup: dropped '${candidate.title}' (${cStart}–${cEnd}) — contained in a kept event`)
      continue
    }

    // Check if an already-kept event is fully contained within this candidate (replace it)
    const dominated = kept.findIndex(k => cStart <= k.date && cEnd >= endOf(k))
    if (dominated >= 0) {
      console.log(`Dedup: replaced '${kept[dominated].title}' with longer '${candidate.title}' (${cStart}–${cEnd})`)
      kept.splice(dominated, 1, candidate)
      continue
    }

    kept.push(candidate)
  }

  return kept
}

// Returns false for events where school is open (term start/end, parents evenings, sports days etc.)
function isSchoolClosedEvent(title: string, locale: string): boolean {
  const lc = title.toLowerCase()
  if (/\b(term (starts?|begins?|opens?|returns?|ends?|closes?|commences?|concludes?)|back to school|school (re)?open(s)?)\b/.test(lc)) return false
  // AU phrasing puts the verb before "Term N" rather than after "term": "Students Commence -
  // Term One" / "Students Conclude - Term Two" - not caught by the pattern above.
  if (/\b(commences?|concludes?)\b.*\bterm\s+(one|two|three|four|[1-4])\b/.test(lc)) return false
  if (/\b(pupils? (return|in school|back)|students? (return|back|commence|conclude)|all year groups? in school|year \d+ in school)\b/.test(lc)) return false
  if (/\b(parents?' evening|open evening|information evening|sports day|prize giving|graduation|speech day)\b/.test(lc)) return false
  // Locale-specific exam types to exclude (unless the event is also a holiday/closure)
  const hasClosedKeyword = /\b(holiday|break|closed)\b/.test(lc)
  if (!hasClosedKeyword) {
    if (locale === 'en-AU' && /\b(hsc|vce|naplan|atar)\b/.test(lc)) return false
    if (locale === 'en-US' && /\b(ap\s+exam|sat|act|state\s+test(?:ing)?|standardized\s+test)\b/.test(lc)) return false
    if (locale === 'en-IE' && /\b(leaving\s+cert|junior\s+cert|lc\s+exam)\b/.test(lc)) return false
    if (locale === 'en-GB' && /\b(exam(ination)?|assessment|ppe|gcse|a.?level)\b/.test(lc)) return false
    if (locale === 'en-NZ' && /\b(ncea)\b/.test(lc)) return false
  }
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
    // UK
    '%half term%', '%half-term%',
    '%end of term%', '%last day of term%', '%first day of term%',
    '%term start%', '%term end%', '%term begin%',
    '%school holiday%', '%school break%', '%school closed%', '%school closes%', '%school returns%',
    '%inset day%',
    '%christmas holid%', '%easter holid%', '%summer holid%',
    '%spring holid%', '%autumn holid%',
    // AU
    '%term 1 holid%', '%term 2 holid%', '%term 3 holid%', '%term 4 holid%',
    '%pupil-free%', '%pupil free%', '%student-free%', '%student free%',
    // US
    '%fall break%', '%spring break%', '%winter break%',
    '%thanksgiving break%',
    '%pd day%', '%professional development day%', '%teacher work day%',
    // IE
    '%midterm break%', '%mid-term break%', '%in-service day%',
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

  const schoolLabel = getLocaleConfig(locale).schoolTypeLabel
  return callClaude(
    `You are analysing why an automated scraper failed to extract term dates from a ${schoolLabel} website.

${lines.join('\n')}

In 2-3 sentences explain: what went wrong, the likely root cause (e.g. homepage too large to scan nav links, server blocking requests, JS-rendered content, cookie wall, PDF-only dates, wrong URL found), and what a developer could try to fix it.`,
    256
  )
}

async function storeDiagnostic(homepageUrl: string, errorMessage: string, diagnostic: Record<string, any>, locale = 'en-GB'): Promise<void> {
  const diagnosis = await generateDiagnosis(homepageUrl, errorMessage, diagnostic).catch(() => null)
  const { error } = await supabase.from('school_calendars').upsert({
    homepage_url:     homepageUrl,
    locale,
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

// Same as callClaude but attaches a base64 PDF as a document content block —
// Claude reads it with vision, so scanned/image-only PDFs work as well as text ones.
async function callClaudeWithDocument(prompt: string, pdfBase64: string, maxTokens: number): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); return null }
  console.log(`callClaudeWithDocument: ${maxTokens} tokens, pdf ~${Math.round(pdfBase64.length * 0.75 / 1024)}KB`)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model:       'claude-haiku-4-5-20251001',
        max_tokens:  maxTokens,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
    console.log(`callClaudeWithDocument: response status ${res.status}`)
    if (!res.ok) {
      console.error('Claude error:', await res.text())
      return null
    }
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } catch (e: any) {
    console.error('callClaudeWithDocument fetch threw:', e?.name, e?.message)
    return null
  }
}
