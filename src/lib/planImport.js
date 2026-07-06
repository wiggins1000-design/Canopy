// Decodes a ?plan= handoff payload from the parenting plan tool
// (parentingplan.help's src/lib/planHandoff.js encodes it) into children +
// schedule data to pre-fill during onboarding. Separate codebases, no shared
// package — the payload shape must be changed in both places together.
export const PLAN_IMPORT_STORAGE_KEY = 'canopy_plan_import'
// Set once an import completes, so AppLayout can show a one-time confirmation
// after OnboardingPage has already unmounted.
export const PLAN_IMPORTED_FLAG = 'canopy_plan_imported'

export function decodePlanImport(encoded) {
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}
