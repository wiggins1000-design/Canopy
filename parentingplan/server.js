import { createServer } from 'http'
import { readFileSync, statSync, existsSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST  = join(__dirname, 'dist')
const PORT  = process.env.PORT || 3000
const INDEX = join(DIST, 'index.html')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webp': 'image/webp',
}

createServer((req, res) => {
  const url  = req.url.split('?')[0].replace(/^\/+/, '')
  let   file = join(DIST, url || 'index.html')

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) file = INDEX  // SPA fallback

  const ext  = extname(file)
  const type = MIME[ext] || 'application/octet-stream'

  res.writeHead(200, { 'Content-Type': type })
  res.end(readFileSync(file))
}).listen(PORT, '0.0.0.0', () =>
  console.log(`parentingplan on :${PORT}`)
)
