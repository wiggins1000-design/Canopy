import sharp from 'sharp'

// Two options to compare
const options = [
  {
    label: 'Current — Canopy Green + Mist',
    a: { bg: '#52b788', text: '#1b4332', dot: '#1b4332', name: 'Canopy Green #52b788' },
    b: { bg: '#d8f3dc', text: '#2d6a4f', dot: '#2d6a4f', name: 'Mist #d8f3dc' },
  },
  {
    label: 'Alternative — Mist + List Grey',
    a: { bg: '#d8f3dc', text: '#2d6a4f', dot: '#2d6a4f', name: 'Mist #d8f3dc' },
    b: { bg: '#e5e7eb', text: '#374151', dot: '#6b7280', name: 'List Grey #e5e7eb' },
  },
]

const custody = [
  0,   0,   'a', 'a', 'b', 'b', 'b',
  'a', 'a', 'a', 'b', 'b', 'b', 'b',
  'a', 'a', 'a', 'a', 'b', 'b', 'b',
  'a', 'a', 'b', 'b', 'b', 'a', 'a',
  'a', 'b', 0,   0,   0,   0,   0,
]

const eventDays  = new Set([7, 14, 20])
const todayIndex = 15
const DAYS       = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const CW = 340, CH = 320, CS = 38, CG = 4, LEFT = 14, TOP_CAL = 52

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

    return `
      <rect x="${cx}" y="${cy}" width="${CS}" height="${CS}" rx="9" fill="${color.bg}"/>
      ${isToday ? `<rect x="${cx}" y="${cy}" width="${CS}" height="${CS}" rx="9" fill="none" stroke="${owner ? color.dot : '#374151'}" stroke-width="2.5"/>` : ''}
      <text x="${cx + CS/2}" y="${cy + CS/2 + 5}"
        text-anchor="middle" font-family="system-ui,sans-serif"
        font-size="13" font-weight="${isToday ? '800' : '600'}"
        fill="${color.text}">${day}</text>
      ${hasEvent ? `<circle cx="${cx + CS/2}" cy="${cy + CS - 5}" r="2.5" fill="#6b7280"/>` : ''}
    `
  }).join('')

  const headers = DAYS.map((d, i) => {
    const x = ox + LEFT + i * (CS + CG) + CS / 2
    return `<text x="${x}" y="${oy + 40}" text-anchor="middle"
      font-family="system-ui,sans-serif" font-size="10" font-weight="600"
      fill="#9ca3af" letter-spacing="0.5">${d}</text>`
  }).join('')

  const header = `
    <text x="${ox + CW/2}" y="${oy + 22}" text-anchor="middle"
      font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="#111827">June 2026</text>
  `

  // Swatches + legend
  const legendY = oy + CH - 42
  const legend = `
    <rect x="${ox + LEFT}" y="${legendY}" width="14" height="14" rx="3" fill="${opt.a.bg}" stroke="#d1d5db" stroke-width="1"/>
    <text x="${ox + LEFT + 20}" y="${legendY + 11}" font-family="system-ui,sans-serif" font-size="11" fill="#374151">${opt.a.name}</text>
    <rect x="${ox + LEFT}" y="${legendY + 22}" width="14" height="14" rx="3" fill="${opt.b.bg}" stroke="#d1d5db" stroke-width="1"/>
    <text x="${ox + LEFT + 20}" y="${legendY + 33}" font-family="system-ui,sans-serif" font-size="11" fill="#374151">${opt.b.name}</text>
  `

  return `
    <rect x="${ox}" y="${oy}" width="${CW}" height="${CH}" rx="16" fill="white" filter="url(#shadow)"/>
    ${header}${headers}${cells}${legend}
  `
}

const PAD = 24
const TW  = PAD * 3 + CW * 2
const TH  = PAD * 3 + 22 + CH

const positions = [
  { ox: PAD,          oy: PAD * 2 + 22 },
  { ox: PAD * 2 + CW, oy: PAD * 2 + 22 },
]

const labels = options.map((opt, i) => {
  const { ox, oy } = positions[i]
  return `<text x="${ox}" y="${oy - 10}" font-family="system-ui,sans-serif"
    font-size="12" font-weight="700" fill="#374151">${opt.label}</text>`
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

await sharp(Buffer.from(svg)).png().toFile('scripts/mist-grey-preview.png')
console.log('Generated scripts/mist-grey-preview.png')
