import { Capacitor } from '@capacitor/core'
import { Purchases } from '@revenuecat/purchases-capacitor'
import { isNativePlatform } from './supabase'
import { Sentry } from './sentry'

// Must match the entitlement identifier configured in the RevenueCat dashboard.
// Named "subscriber" not "premium" — Canopy has no free tier, so "premium" would
// wrongly imply an upgrade from some base level that doesn't exist.
const ENTITLEMENT_ID = 'subscriber'

let configured = false
// Tracks which family the SDK is currently configured for — a device can see more
// than one family in the same app process during manual testing (sign out of one
// account, accept an invite as another), and without this initRevenueCat() would
// silently keep serving the FIRST family's entitlement state forever.
let configuredFamilyId = null
// initRevenueCat() is called from FamilyContext as soon as family.id loads, but
// PaywallOverlay (a descendant) fetches the offering in its own effect around the
// same time — React fires child effects before parent effects on the same commit,
// so getCurrentOffering() would otherwise race ahead of configure() finishing and
// permanently give up (its caller never retries). Sharing the in-flight promise
// lets any caller await the same configure() attempt instead of racing it.
let configuringPromise = null
let configuringFamilyId = null

// No-ops entirely on web/PWA (Apple/Google IAP only exists in the native app) and
// if no API key is set yet — mirrors the Sentry init pattern so this is safe to
// call before RevenueCat products actually exist.
export async function initRevenueCat(familyId) {
  if (!isNativePlatform()) {
    Sentry.captureMessage('RevenueCat init skipped: not native platform', 'info')
    return
  }
  if (configured && configuredFamilyId === familyId) return
  if (!familyId) {
    Sentry.captureMessage('RevenueCat init skipped: no familyId', 'info')
    return
  }
  // Each platform's RevenueCat app has its own public SDK key (appl_.../goog_...) —
  // configuring with the wrong platform's key still fetches offerings (shared
  // project-wide metadata) but silently fails the actual native purchase call.
  const apiKey = Capacitor.getPlatform() === 'android'
    ? import.meta.env.VITE_REVENUECAT_ANDROID_KEY
    : import.meta.env.VITE_REVENUECAT_IOS_KEY
  if (!apiKey) {
    Sentry.captureMessage('RevenueCat init skipped: no API key configured', 'warning')
    return
  }
  if (configuringPromise && configuringFamilyId === familyId) return configuringPromise

  configuringFamilyId = familyId
  configuringPromise = (async () => {
    try {
      // appUserID = family.id, not the individual parent's user id — "both parents
      // included, one price" means whichever parent purchases unlocks the whole
      // family, checked here by keying RevenueCat's identity to the family itself.
      // Calling configure() again with a different appUserID is the supported way
      // to switch identities (e.g. testing multiple families in one app session)
      // rather than requiring a full app restart.
      await Purchases.configure({ apiKey, appUserID: familyId })
      configured = true
      configuredFamilyId = familyId
      Sentry.captureMessage('RevenueCat configured successfully', 'info')
    } catch (e) {
      console.error('RevenueCat configure failed:', e)
      Sentry.captureException(e, { tags: { context: 'revenuecat_configure' } })
    }
  })()
  await configuringPromise
}

export function isRevenueCatReady() {
  return configured
}

export async function getCurrentOffering() {
  // PaywallOverlay's effect can fire before FamilyContext's initRevenueCat() call
  // has even started (child effects run before parent effects on the same React
  // commit) — configuringPromise may still be null at that instant, not just
  // pending. Poll briefly for it to appear before giving up, rather than only
  // awaiting it if it already exists.
  for (let i = 0; i < 25 && !configuringPromise && !configured; i++) {
    await new Promise((r) => setTimeout(r, 200))
  }
  if (configuringPromise) await configuringPromise
  if (!configured) {
    Sentry.captureMessage('RevenueCat getOfferings skipped: not configured', 'warning')
    return null
  }
  try {
    const offerings = await Purchases.getOfferings()
    if (!offerings.current) {
      Sentry.captureMessage('RevenueCat getOfferings returned no current offering', 'warning')
    }
    return offerings.current
  } catch (e) {
    console.error('RevenueCat getOfferings failed:', e)
    Sentry.captureException(e, { tags: { context: 'revenuecat_get_offerings' } })
    return null
  }
}

export async function purchasePackage(pkg) {
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg })
  return customerInfo
}

export async function restorePurchases() {
  const { customerInfo } = await Purchases.restorePurchases()
  return customerInfo
}

export function hasActiveEntitlement(customerInfo) {
  return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]
}
