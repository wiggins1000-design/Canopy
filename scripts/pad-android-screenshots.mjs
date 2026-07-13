// Pads the iOS App Store screenshots (1242x2688, ratio ~2.16:1) with solid
// Forest Deep bars on left/right so they satisfy Google Play's screenshot
// aspect-ratio limit. Padding (not cropping) was chosen deliberately -- these
// screenshots have content running to the very top/bottom edges in places
// (no safe margin to crop from), so padding is the only way to fix the ratio
// without cutting into real content.
//
// Target ratio 16:9 (~1.78:1) rather than the sometimes-cited 2:1 cap, to be
// safe under whichever limit Play Console actually enforces.
import sharp from 'sharp'
import { readdirSync, mkdirSync } from 'fs'

const SRC_DIR = 'website/images/apple/images-net-descarga'
const OUT_DIR = 'website/images/google-play'
const FOREST_DEEP = { r: 27, g: 67, b: 50, alpha: 1 }
const MAX_RATIO = 16 / 9

mkdirSync(OUT_DIR, { recursive: true })

async function run() {
  for (const file of readdirSync(SRC_DIR).sort()) {
    const src = `${SRC_DIR}/${file}`
    const { width, height } = await sharp(src).metadata()

    const targetWidth = Math.ceil(height / MAX_RATIO)
    const padTotal = Math.max(0, targetWidth - width)
    const padLeft = Math.floor(padTotal / 2)
    const padRight = padTotal - padLeft

    const outName = file.trim().replace(/\s+/g, '_')
    const outPath = `${OUT_DIR}/${outName}`

    await sharp(src)
      .flatten({ background: FOREST_DEEP }) // drop alpha, Play requires 24-bit PNG
      .extend({ left: padLeft, right: padRight, top: 0, bottom: 0, background: FOREST_DEEP })
      .png()
      .toFile(outPath)

    const outMeta = await sharp(outPath).metadata()
    console.log(`${file} -> ${outName}: ${outMeta.width}x${outMeta.height} (ratio ${(outMeta.height/outMeta.width).toFixed(3)})`)
  }
}

run().catch((e) => { console.error(e); process.exit(1) })
