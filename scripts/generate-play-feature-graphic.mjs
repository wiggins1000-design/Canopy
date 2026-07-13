// Generates the Google Play "Feature graphic" (1024x500, JPG/24-bit PNG, no
// alpha) -- a Play-only asset with no App Store equivalent. Forest Deep
// background with the logo recoloured for legibility (dark green text is
// invisible on a dark green bg, so it's swapped to Mist), matching the
// treatment already used for canopy-app.app's own dark-bg surfaces.
import sharp from 'sharp'

const SOURCE = 'CanopyWhiteLogo.png'
const OUT = 'website/images/google-play/play-feature-graphic.png'
const FOREST_DEEP = { r: 27, g: 67, b: 50, alpha: 1 }
const MIST = [0xd8, 0xf3, 0xdc]
const CANVAS_W = 1024
const CANVAS_H = 500

async function prepareLogo() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = new Uint8ClampedArray(data)
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    if (r > 240 && g > 240 && b > 240) { px[i + 3] = 0; continue } // near-white -> transparent
    if (r < 60 && g < 115 && b < 90) { px[i] = MIST[0]; px[i + 1] = MIST[1]; px[i + 2] = MIST[2] } // dark green -> Mist
  }
  return sharp(Buffer.from(px), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

async function run() {
  const logo = await prepareLogo()
  const targetLogoWidth = Math.round(CANVAS_W * 0.55)
  const resized = await sharp(logo).resize(targetLogoWidth, null, { fit: 'inside' }).png().toBuffer()
  const { width: lw, height: lh } = await sharp(resized).metadata()

  const taglineSvg = `
    <svg width="${CANVAS_W}" height="80">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="34" fill="#a8d5b5">
        Share what matters.
      </text>
    </svg>`
  const taglineBuf = Buffer.from(taglineSvg)

  const totalContentHeight = lh + 20 + 60
  const startY = Math.round((CANVAS_H - totalContentHeight) / 2)

  await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: FOREST_DEEP } })
    .composite([
      { input: resized, left: Math.round((CANVAS_W - lw) / 2), top: startY },
      { input: taglineBuf, left: 0, top: startY + lh + 15 },
    ])
    .flatten({ background: FOREST_DEEP })
    .removeAlpha()
    .png()
    .toFile(OUT)

  const meta = await sharp(OUT).metadata()
  console.log('Generated:', meta.width, meta.height, meta.hasAlpha ? 'has alpha (bad)' : 'no alpha (correct)')
}

run().catch((e) => { console.error(e); process.exit(1) })
