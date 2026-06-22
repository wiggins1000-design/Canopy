import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://zhxuegizpmukynifstuu.supabase.co'

// Short calendar feed URL — redirects to the Supabase edge function
app.get('/cal/:token', (req, res) => {
  const types = req.query.types || 'schedule,events,term_dates,schedule_changes'
  res.redirect(302, `${SUPABASE_URL}/functions/v1/calendar-feed?token=${req.params.token}&types=${types}`)
})

// Static SPA
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

app.listen(PORT, () => console.log(`Canopy server on port ${PORT}`))
