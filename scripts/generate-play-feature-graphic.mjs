// Generates the Google Play "Feature graphic" (1024x500, JPG/24-bit PNG, no
// alpha) -- a Play-only asset with no App Store equivalent. Uses the
// artwork from the pre-made CanopyGreenLogo.gif (white wordmark on a Forest
// Deep background) directly.
//
// The GIF's "solid" background isn't actually flat -- GIF palette
// quantization/dithering leaves subtle noise -- which showed up as a visible
// rectangle seam in earlier attempts that recomposited a cropped region of
// it onto a separately-filled canvas. Fixed by extracting *only* the white
// wordmark/leaf shapes as a clean alpha silhouette (thresholding for
// near-white pixels) and discarding the noisy green background entirely,
// then compositing that clean cutout onto a flat brand-colour fill -- same
// source artwork, no dithering carried over.
import sharp from 'sharp'

const SOURCE = 'CanopyGreenLogo.gif'
const OUT = 'website/images/google-play/play-feature-graphic.png'
const FOREST_DEEP = { r: 0x1b, g: 0x43, b: 0x32, alpha: 1 }
const CANVAS_W = 1024
const CANVAS_H = 500
const NEAR_WHITE = 180

async function extractWhiteSilhouette() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = new Uint8ClampedArray(data)
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) {
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255 // clean opaque white
    } else {
      px[i + 3] = 0 // everything else -> transparent (discards the dithered green)
    }
  }
  const full = sharp(Buffer.from(px), { raw: { width: info.width, height: info.height, channels: 4 } })
  const bounds = await findContentBounds(px, info.width, info.height, info.channels)
  return full.extract(bounds).png().toBuffer()
}

async function findContentBounds(data, width, height, channels) {
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      if (data[i + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function run() {
  const logo = await extractWhiteSilhouette()
  const targetLogoWidth = Math.round(CANVAS_W * 0.6)
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
