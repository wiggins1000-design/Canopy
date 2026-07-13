// Generates Android launcher icons (legacy + adaptive foreground) from the
// same master icon already approved and live on iOS
// (ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png).
//
// The raw iOS icon has only ~8% built-in padding, which is fine for iOS's
// gentler rounded-square mask but gets visibly clipped by Android launchers'
// more aggressive masks (circle/squircle) -- especially the wide "canopy"
// wordmark's left/right edges and the leaf shapes on top. This script finds
// the logo's real content bounding box and re-pads it generously (~30% margin)
// onto a fresh white square before generating each density.
import sharp from 'sharp'

const SOURCE = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
const RES_DIR = 'android/app/src/main/res'
const NEAR_WHITE = 245

const DENSITIES = {
  mdpi:    { legacy: 48,  foreground: 108 },
  hdpi:    { legacy: 72,  foreground: 162 },
  xhdpi:   { legacy: 96,  foreground: 216 },
  xxhdpi:  { legacy: 144, foreground: 324 },
  xxxhdpi: { legacy: 192, foreground: 432 },
}

async function findContentBounds(buffer, width, height, channels) {
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const r = buffer[i], g = buffer[i + 1], b = buffer[i + 2]
      const isWhiteish = r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE
      if (!isWhiteish) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function buildPaddedMaster() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = await findContentBounds(data, info.width, info.height, info.channels)
  console.log('content bounds:', bounds)

  const logo = await sharp(SOURCE).extract(bounds).png().toBuffer()
  const { width: lw, height: lh } = await sharp(logo).metadata()

  // Target: logo occupies ~62% of the square canvas's larger dimension,
  // safely inside Android adaptive icons' ~66% guaranteed-visible zone.
  const CANVAS = 1024
  const maxLogoDim = Math.round(CANVAS * 0.62)
  const scale = maxLogoDim / Math.max(lw, lh)
  const resizedW = Math.round(lw * scale)
  const resizedH = Math.round(lh * scale)

  const resizedLogo = await sharp(logo).resize(resizedW, resizedH).png().toBuffer()

  return sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: resizedLogo, left: Math.round((CANVAS - resizedW) / 2), top: Math.round((CANVAS - resizedH) / 2) }])
    .png()
    .toBuffer()
}

async function run() {
  const master = await buildPaddedMaster()

  for (const [density, { legacy, foreground }] of Object.entries(DENSITIES)) {
    const dir = `${RES_DIR}/mipmap-${density}`

    const legacyBuf = await sharp(master).resize(legacy, legacy).png().toBuffer()
    await sharp(legacyBuf).toFile(`${dir}/ic_launcher.png`)
    await sharp(legacyBuf).toFile(`${dir}/ic_launcher_round.png`)

    await sharp(master).resize(foreground, foreground).png().toFile(`${dir}/ic_launcher_foreground.png`)

    console.log(`✓ ${density}: legacy ${legacy}px, foreground ${foreground}px`)
  }
}

run().catch((e) => { console.error(e); process.exit(1) })
