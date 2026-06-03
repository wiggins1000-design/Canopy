// Run once with: node scripts/generate-icons.js
// Generates public/icons/icon-192.png and icon-512.png

import sharp from 'sharp'
import { mkdirSync } from 'fs'

mkdirSync('public/icons', { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="115" fill="#2563eb"/>
  <text
    x="256" y="345"
    font-family="Arial, Helvetica, sans-serif"
    font-size="380"
    font-weight="700"
    fill="white"
    text-anchor="middle"
  >C</text>
</svg>`

const buffer = Buffer.from(svg)

await sharp(buffer).resize(512, 512).png().toFile('public/icons/icon-512.png')
console.log('✓ icon-512.png')

await sharp(buffer).resize(192, 192).png().toFile('public/icons/icon-192.png')
console.log('✓ icon-192.png')

console.log('Icons generated in public/icons/')
