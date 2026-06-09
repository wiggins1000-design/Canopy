import sharp from 'sharp'
import { readFileSync } from 'fs'

const FOREST_DEEP = { r: 27, g: 67, b: 50, alpha: 1 }   // #1b4332
const LOGO_PATH   = 'CanopyLogo.gif'

async function prepareLogo(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const px = new Uint8ClampedArray(data)
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    // Make near-white transparent
    if (r > 240 && g > 240 && b > 240) { px[i + 3] = 0; continue }
    // Recolour dark Forest Deep pixels to Mist (#d8f3dc) for dark-bg legibility
    // Forest Deep (#1b4332): r≈27, g≈67, b≈50 — well below these thresholds
    if (r < 60 && g < 115 && b < 90) {
      px[i] = 0xd8; px[i + 1] = 0xf3; px[i + 2] = 0xdc
    }
  }
  return sharp(Buffer.from(px), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

async function generateIcons() {
  // Convert GIF → PNG buffer, then remove white background
  const logoPng    = await sharp(LOGO_PATH).png().toBuffer()
  const logoNoBg   = await prepareLogo(logoPng)
  const { width: logoW, height: logoH } = await sharp(logoNoBg).metadata()
  console.log(`Logo: ${logoW}x${logoH}`)

  for (const size of [512, 192]) {
    const padding = Math.round(size * 0.1)
    const inner   = size - padding * 2

    // Resize logo to fit inside the inner area, preserving aspect ratio
    const resized = await sharp(logoNoBg)
      .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()

    const { width: rw, height: rh } = await sharp(resized).metadata()
    const left = Math.round((size - rw) / 2)
    const top  = Math.round((size - rh) / 2)

    await sharp({
      create: { width: size, height: size, channels: 4, background: FOREST_DEEP },
    })
      .composite([{ input: resized, left, top }])
      .png()
      .toFile(`public/icons/icon-${size}.png`)

    console.log(`Generated public/icons/icon-${size}.png`)
  }
}

generateIcons().catch((e) => { console.error(e); process.exit(1) })
