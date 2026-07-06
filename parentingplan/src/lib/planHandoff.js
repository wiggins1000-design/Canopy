// Encodes this plan's schedule + children into a compact payload for the
// "Continue in Canopy" CTA (?plan=<value> on my.canopy-app.app). The main
// Canopy app's src/lib/planImport.js decodes this — these are separate
// codebases with no shared package, so the payload shape must be changed in
// both places together or the handoff silently breaks.
export function encodePlanHandoff({ children, patternType, startingParent, customCycle }) {
  const payload = {
    children: (children ?? [])
      .filter((c) => c.name?.trim())
      .map((c) => ({ name: c.name.trim(), dob: c.dob || undefined })),
    patternType,
    startingParent,
    customCycle: patternType === 'custom' ? customCycle : undefined,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary)
}
