// Run once with: node scripts/generate-icons.js
// Generates public/icons/icon-192.png and icon-512.png

import sharp from 'sharp'
import { mkdirSync } from 'fs'

mkdirSync('public/icons', { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <!-- Blue rounded background -->
  <rect width="512" height="512" rx="115" fill="#2563eb"/>

  <!-- Canopy: three overlapping circles (classic tree shape) -->
  <circle cx="256" cy="185" r="100" fill="white"/>
  <circle cx="168" cy="235" r="88" fill="white"/>
  <circle cx="344" cy="235" r="88" fill="white"/>

  <!-- Fill gap between circles -->
  <rect x="148" y="225" width="216" height="80" fill="white"/>

  <!-- Trunk -->
  <rect x="224" y="298" width="64" height="108" rx="14" fill="white"/>

  <!-- Ground line -->
  <rect x="158" y="390" width="196" height="20" rx="10" fill="white" opacity="0.6"/>
</svg>`

const buffer = Buffer.from(svg)

await sharp(buffer).resize(512, 512).png().toFile('public/icons/icon-512.png')
console.log('✓ icon-512.png')

await sharp(buffer).resize(192, 192).png().toFile('public/icons/icon-192.png')
console.log('✓ icon-192.png')

console.log('Icons generated in public/icons/')
