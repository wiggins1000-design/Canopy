import { Purchases } from '@revenuecat/purchases-capacitor'
import { isNativePlatform } from './supabase'
import { Sentry } from './sentry'

// Must match the entitlement identifier configured in the RevenueCat dashboard.
// Named "subscriber" not "premium" — Canopy has no free tier, so "premium" would
// wrongly imply an upgrade from some base level that doesn't exist.
const ENTITLEMENT_ID = 'subscriber'

let configured = false

// No-ops entirely on web/PWA (Apple/Google IAP only exists in the native app) and
// if no API key is set yet — mirrors the Sentry init pattern so this is safe to
// call before RevenueCat products actually exist.
export async function initRevenueCat(familyId) {
  if (!isNativePlatform()) {
    Sentry.captureMessage('RevenueCat init skipped: not native platform', 'info')
    return
  }
  if (configured) return
  if (!familyId) {
    Sentry.captureMessage('RevenueCat init skipped: no familyId', 'info')
    return
  }
  const apiKey = import.meta.env.VITE_REVENUECAT_IOS_KEY
  if (!apiKey) {
    Sentry.captureMessage('RevenueCat init skipped: no API key configured', 'warning')
    return
  }
  try {
    // appUserID = family.id, not the individual parent's user id — "both parents
    // included, one price" means whichever parent purchases unlocks the whole
    // family, checked here by keying RevenueCat's identity to the family itself.
    await Purchases.configure({ apiKey, appUserID: familyId })
    configured = true
    Sentry.captureMessage('RevenueCat configured successfully', 'info')
  } catch (e) {
    console.error('RevenueCat configure failed:', e)
    Sentry.captureException(e, { tags: { context: 'revenuecat_configure' } })
  }
}

export function isRevenueCatReady() {
  return configured
}

export async function getCurrentOffering() {
  if (!configured) return null
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
