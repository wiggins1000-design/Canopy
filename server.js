import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://zhxuegizpmukynifstuu.supabase.co'

// Short calendar feed URL — proxies to the Supabase edge function
app.get('/cal/:token', async (req, res) => {
  const types = req.query.types || 'schedule,events,term_dates,schedule_changes'
  const upstream = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${req.params.token}&types=${types}`
  try {
    const r = await fetch(upstream)
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    // No Content-Disposition — Outlook treats 'attachment' as a download, not a subscription
    res.status(r.status).send(await r.text())
  } catch {
    res.status(502).send('Calendar feed unavailable')
  }
})

// Static SPA
app.use(express.static(join(__dirname, 'dist')))
app.use((_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

app.listen(PORT, () => console.log(`Canopy server on port ${PORT}`))
