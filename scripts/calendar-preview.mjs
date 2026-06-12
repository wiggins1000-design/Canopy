import sharp from 'sharp'

const options = [
  {
    label: 'Option 1 — Forest Mid + Canopy Light',
    a: { bg: '#2d6a4f', text: '#f4fbf4', dot: '#74c69d' },
    b: { bg: '#74c69d', text: '#1b4332', dot: '#2d6a4f' },
  },
  {
    label: 'Option 2 — Canopy Green + Mist',
    a: { bg: '#52b788', text: '#1b4332', dot: '#1b4332' },
    b: { bg: '#d8f3dc', text: '#2d6a4f', dot: '#2d6a4f' },
  },
  {
    label: 'Option 3 — Forest Deep + Canopy Light',
    a: { bg: '#1b4332', text: '#d8f3dc', dot: '#74c69d' },
    b: { bg: '#74c69d', text: '#1b4332', dot: '#1b4332' },
  },
  {
    label: 'Option 4 — Forest Mid + Warm Amber',
    a: { bg: '#2d6a4f', text: '#f4fbf4', dot: '#74c69d' },
    b: { bg: '#e9c46a', text: '#3d2c00', dot: '#9a6b00' },
  },
]

// Custody pattern for a month (0=none, a=parent_a, b=parent_b)
const custody = [
  0,   0,   'a', 'a', 'b', 'b', 'b',
  'a', 'a', 'a', 'b', 'b', 'b', 'b',
  'a', 'a', 'a', 'a', 'b', 'b', 'b',
  'a', 'a', 'b', 'b', 'b', 'a', 'a',
  'a', 'b', 0,   0,   0,   0,   0,
]

const eventDays  = new Set([7, 14, 20])   // days with event dots
const todayIndex = 15                      // index of "today"
const DAYS       = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const CW = 340   // calendar width
const CH = 310   // calendar height
const CS = 38    // cell size
const CG = 4     // gap
const LEFT = 14
const TOP_CAL = 52

function calendar(opt, ox, oy) {
  const cells = custody.map((owner, i) => {
    const col   = i % 7
    const row   = Math.floor(i / 7)
    const cx    = ox + LEFT + col * (CS + CG)
    const cy    = oy + TOP_CAL + row * (CS + CG)
    const day   = i + 1
    const color = owner === 'a' ? opt.a : owner === 'b' ? opt.b : { bg: '#f9fafb', text: '#9ca3af', dot: '#9ca3af' }
    const isToday = i === todayIndex
    const hasEvent = eventDays.has(day)

    const cell = `
      <rect x="${cx}" y="${cy}" width="${CS}" height="${CS}" rx="9" fill="${color.bg}"/>
      ${isToday ? `<rect x="${cx}" y="${cy}" width="${CS}" height="${CS}" rx="9" fill="none" stroke="${owner ? color.dot : '#374151'}" stroke-width="2"/>` : ''}
      <text x="${cx + CS/2}" y="${cy + CS/2 + 5}"
        text-anchor="middle" font-family="system-ui,sans-serif"
        font-size="13" font-weight="${isToday ? '800' : '600'}"
        fill="${color.text}" ${isToday ? 'text-decoration="underline"' : ''}>${day}</text>
      ${hasEvent ? `<circle cx="${cx + CS/2}" cy="${cy + CS - 5}" r="2.5" fill="#6b7280"/>` : ''}
    `
    return cell
  }).join('')

  const headers = DAYS.map((d, i) => {
    const x = ox + LEFT + i * (CS + CG) + CS / 2
    return `<text x="${x}" y="${oy + 40}" text-anchor="middle"
      font-family="system-ui,sans-serif" font-size="10" font-weight="600"
      fill="#9ca3af" letter-spacing="0.5">${d}</text>`
  }).join('')

  // Month header
  const header = `
    <text x="${ox + CW/2}" y="${oy + 22}" text-anchor="middle"
      font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="#111827">June 2026</text>
  `

  // Legend
  const legendY = oy + CH - 24
  const legend = `
    <circle cx="${ox + LEFT + 6}" cy="${legendY}" r="5" fill="${opt.a.bg}" stroke="#e5e7eb" stroke-width="0.5"/>
    <text x="${ox + LEFT + 15}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="10" fill="#6b7280">Parent A</text>
    <circle cx="${ox + LEFT + 72}" cy="${legendY}" r="5" fill="${opt.b.bg}" stroke="#e5e7eb" stroke-width="0.5"/>
    <text x="${ox + LEFT + 81}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="10" fill="#6b7280">Parent B</text>
    <circle cx="${ox + LEFT + 138}" cy="${legendY}" r="5" fill="#6b7280"/>
    <text x="${ox + LEFT + 147}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="10" fill="#6b7280">Events</text>
  `

  return `
    <rect x="${ox}" y="${oy}" width="${CW}" height="${CH}" rx="16" fill="white"
      filter="url(#shadow)"/>
    ${header}${headers}${cells}${legend}
  `
}

// Layout: 2 columns × 2 rows
const PAD = 24
const TW  = PAD + (CW + PAD) * 2
const TH  = PAD * 2 + 22 + (CH + PAD + 28) * 2

const positions = [
  { ox: PAD,          oy: PAD * 2 + 22 },
  { ox: PAD * 2 + CW, oy: PAD * 2 + 22 },
  { ox: PAD,          oy: PAD * 2 + 22 + CH + PAD + 28 },
  { ox: PAD * 2 + CW, oy: PAD * 2 + 22 + CH + PAD + 28 },
]

const labels = options.map((opt, i) => {
  const { ox, oy } = positions[i]
  return `
    <text x="${ox}" y="${oy - 10}" font-family="system-ui,sans-serif"
      font-size="12" font-weight="700" fill="#374151">${opt.label}</text>
  `
}).join('')

const calendars = options.map((opt, i) => calendar(opt, positions[i].ox, positions[i].oy)).join('')

const svg = `
<svg width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#00000015"/>
    </filter>
  </defs>
  <rect width="${TW}" height="${TH}" fill="#f3f4f6"/>
  ${labels}${calendars}
</svg>`

await sharp(Buffer.from(svg)).png().toFile('scripts/calendar-preview.png')
console.log('Generated scripts/calendar-preview.png')
