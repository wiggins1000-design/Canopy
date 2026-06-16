import express from 'express'
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { Browser, Page } from 'puppeteer-core'
import pdfParse from 'pdf-parse'
import Anthropic from '@anthropic-ai/sdk'

puppeteerExtra.use(StealthPlugin())

const PORT          = parseInt(process.env.PORT ?? '3000')
const READER_SECRET = process.env.READER_SECRET ?? ''
const CHROME_PATH   = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium'

const app       = express()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// ── Browser singleton ─────────────────────────────────────────────────────────

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser!
  console.log('Launching browser…')
  browser = await puppeteerExtra.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  }) as unknown as Browser
  browser!.on('disconnected', () => {
    console.warn('Browser disconnected — will relaunch on next request')
    browser = null
  })
  return browser!
}

// Keep browser warm — launch on startup
getBrowser().catch(console.error)

// ── Auth middleware ───────────────────────────────────────────────────────────

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!READER_SECRET) return next()
  const token = req.headers.authorization?.replace('Bearer ', '') ?? req.query.secret
  if (token !== READER_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }))

// GET /fetch?url=<url>
// Returns plain text content of the URL — handles HTML, JS pages, PDFs, images
app.get('/fetch', auth, async (req, res) => {
  const url = req.query.url as string
  if (!url) { res.status(400).json({ error: 'Missing url param' }); return }

  console.log(`/fetch ${url}`)
  try {
    const text = await fetchUrl(url)
    res.set('Content-Type', 'text/plain; charset=utf-8').send(text)
  } catch (e: any) {
    console.error(`/fetch error for ${url}:`, e?.message)
    res.status(500).json({ error: e?.message ?? 'Fetch failed' })
  }
})

app.listen(PORT, () => console.log(`canopy-reader listening on :${PORT}`))

// ── Main dispatcher ───────────────────────────────────────────────────────────

async function fetchUrl(url: string): Promise<string> {
  // HEAD request to detect content type without downloading the body
  let contentType = ''
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Canopy/1.0)' },
    })
    contentType = head.headers.get('content-type') ?? ''
  } catch {
    // HEAD not supported by some servers — fall through to URL-based detection
  }

  const lurl = url.toLowerCase()

  if (contentType.includes('pdf') || lurl.endsWith('.pdf')) {
    return fetchPdf(url)
  }

  if (contentType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(lurl)) {
    return fetchImageViaVision(url)
  }

  // HTML (static or JS-rendered) — use Puppeteer
  return fetchHtml(url)
}

// ── HTML extractor ────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const b    = await getBrowser()
  const page = await b.newPage()
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36')
    await page.setViewport({ width: 1280, height: 900 })

    await page.goto(url, { waitUntil: 'load', timeout: 20000 })

    // Wait for JS-rendered content and allow Cloudflare challenges to resolve
    await page.evaluate(() => new Promise(r => setTimeout(r, 3000)))

    const text = await page.evaluate(() => {
      // Remove boilerplate that adds noise for LLMs
      const noise = [
        'script', 'style', 'noscript', 'svg', 'iframe',
        'nav', 'header', 'footer',
        '[class*="cookie"]', '[id*="cookie"]',
        '[class*="banner"]', '[class*="popup"]',
        '[class*="modal"]',  '[id*="modal"]',
        '[class*="menu"]',   '[id*="menu"]',
      ]
      noise.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => el.remove()) } catch {}
      })

      // Prefer focused content containers
      const main =
        document.querySelector('main') ??
        document.querySelector('article') ??
        document.querySelector('[role="main"]') ??
        document.querySelector('.content') ??
        document.querySelector('#content') ??
        document.querySelector('.main-content') ??
        document.querySelector('#main-content') ??
        document.body

      return main?.innerText ?? ''
    })

    return text.slice(0, 60000)
  } finally {
    await page.close().catch(() => {})
  }
}

// ── PDF extractor ─────────────────────────────────────────────────────────────

async function fetchPdf(url: string): Promise<string> {
  const res    = await fetch(url, { signal: AbortSignal.timeout(25000) })
  const buffer = Buffer.from(await res.arrayBuffer())

  // Try text extraction first (fast, free, works for 90% of PDFs)
  try {
    const data = await pdfParse(buffer, { max: 15 })
    const text = data.text.trim()
    if (text.length > 150) {
      console.log(`pdf-parse succeeded: ${text.length} chars`)
      return text.slice(0, 60000)
    }
    console.log('pdf-parse returned no text — likely scanned PDF, falling back to Vision')
  } catch (e) {
    console.log('pdf-parse failed:', (e as Error).message, '— falling back to Vision')
  }

  // Scanned PDF — render pages via Puppeteer and read with Claude Vision
  return fetchPdfViaVision(url)
}

async function fetchPdfViaVision(url: string): Promise<string> {
  const b    = await getBrowser()
  const page = await b.newPage()
  try {
    await page.setViewport({ width: 1200, height: 1600 })
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })

    // Chrome renders PDFs natively; capture the first two "screens"
    const results: string[] = []
    for (let scroll = 0; scroll < 2; scroll++) {
      if (scroll > 0) {
        await page.evaluate((h) => window.scrollBy(0, h), 1600)
        await page.evaluate(() => new Promise(r => setTimeout(r, 500)))
      }
      const shot = await page.screenshot({ encoding: 'base64', type: 'png' })
      const text = await callClaudeVision(
        shot as string,
        'image/png',
        'Extract ALL text from this PDF page exactly as it appears. Return only the extracted text.'
      )
      if (text) results.push(text)
    }

    return results.join('\n\n').slice(0, 60000)
  } finally {
    await page.close().catch(() => {})
  }
}

// ── Image extractor ───────────────────────────────────────────────────────────

async function fetchImageViaVision(url: string): Promise<string> {
  const res        = await fetch(url, { signal: AbortSignal.timeout(20000) })
  const buffer     = Buffer.from(await res.arrayBuffer())
  const base64     = buffer.toString('base64')
  const mediaType  = (res.headers.get('content-type') ?? 'image/jpeg') as
    'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  return callClaudeVision(
    base64,
    mediaType,
    'Extract ALL text from this image exactly as it appears. Return only the extracted text.'
  )
}

// ── Claude Vision ─────────────────────────────────────────────────────────────

async function callClaudeVision(
  base64:    string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
  prompt:    string
): Promise<string> {
  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text',  text: prompt },
      ],
    }],
  })
  return response.content[0].type === 'text' ? response.content[0].text : ''
}
