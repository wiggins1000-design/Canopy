import sharp from 'sharp'

const W = 720, H = 820
const GRAY = '#6b7280'

const options = [
  {
    label: 'Option 1 — Forest Mid + Canopy Light',
    a: { bg: '#2d6a4f', text: '#f4fbf4', name: 'Forest Mid #2d6a4f' },
    b: { bg: '#74c69d', text: '#1b4332', name: 'Canopy Light #74c69d' },
  },
  {
    label: 'Option 2 — Canopy Green + Mist',
    a: { bg: '#52b788', text: '#1b4332', name: 'Canopy Green #52b788' },
    b: { bg: '#d8f3dc', text: '#2d6a4f', name: 'Mist #d8f3dc' },
  },
  {
    label: 'Option 3 — Forest Deep + Canopy Light',
    a: { bg: '#1b4332', text: '#d8f3dc', name: 'Forest Deep #1b4332' },
    b: { bg: '#74c69d', text: '#1b4332', name: 'Canopy Light #74c69d' },
  },
  {
    label: 'Option 4 — Forest Mid + Warm Amber',
    a: { bg: '#2d6a4f', text: '#f4fbf4', name: 'Forest Mid #2d6a4f' },
    b: { bg: '#e9c46a', text: '#3d2c00', name: 'Warm Amber #e9c46a' },
  },
]

// Generate one row of 7 calendar day cells for a given pattern
function calRow(pattern, a, b, y, cellSize, gap) {
  return pattern.map((owner, i) => {
    const x = 40 + i * (cellSize + gap)
    const col = owner === 'a' ? a : owner === 'b' ? b : { bg: '#f9fafb', text: '#9ca3af' }
    const day = 12 + i
    return `
      <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="10" fill="${col.bg}" />
      <text x="${x + cellSize/2}" y="${y + cellSize/2 + 5}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${col.text}">${day}</text>
    `
  }).join('')
}

function optionSvg(opt, y) {
  const cs = 70, gap = 8
  const row1 = ['a','b','a','a','b','a','b']
  const row2 = ['b','a','b','b','a','b','a']
  const cells1 = calRow(row1, opt.a, opt.b, y + 52, cs, gap)
  const cells2 = calRow(row2, opt.a, opt.b, y + 52 + cs + gap, cs, gap)

  // Swatch row
  const swatchY = y + 52 + (cs + gap) * 2 + 12
  const swatch = `
    <rect x="40" y="${swatchY}" width="28" height="28" rx="6" fill="${opt.a.bg}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="76" y="${swatchY + 19}" font-family="system-ui,sans-serif" font-size="13" fill="#374151">${opt.a.name}</text>
    <rect x="40" y="${swatchY + 36}" width="28" height="28" rx="6" fill="${opt.b.bg}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="76" y="${swatchY + 55}" font-family="system-ui,sans-serif" font-size="13" fill="#374151">${opt.b.name}</text>
  `

  return `
    <rect x="20" y="${y}" width="${W - 40}" height="190" rx="14" fill="white" stroke="#e5e7eb" stroke-width="1.5"/>
    <text x="40" y="${y + 30}" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="#111827">${opt.label}</text>
    ${cells1}${cells2}${swatch}
  `
}

const svgParts = options.map((opt, i) => optionSvg(opt, 20 + i * 200)).join('')

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#f3f4f6"/>
  <text x="${W/2}" y="18" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#6b7280">Parent A · Parent B · No custody (grey)</text>
  ${svgParts}
</svg>`

await sharp(Buffer.from(svg)).png().toFile('scripts/colour-options.png')
console.log('Generated scripts/colour-options.png')
