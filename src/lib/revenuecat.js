import { Purchases } from '@revenuecat/purchases-capacitor'
import { isNativePlatform } from './supabase'

// Must match the entitlement identifier configured in the RevenueCat dashboard.
const ENTITLEMENT_ID = 'premium'

let configured = false

// No-ops entirely on web/PWA (Apple/Google IAP only exists in the native app) and
// if no API key is set yet — mirrors the Sentry init pattern so this is safe to
// call before RevenueCat products actually exist.
export async function initRevenueCat(familyId) {
  if (!isNativePlatform() || configured || !familyId) return
  const apiKey = import.meta.env.VITE_REVENUECAT_IOS_KEY
  if (!apiKey) return
  try {
    // appUserID = family.id, not the individual parent's user id — "both parents
    // included, one price" means whichever parent purchases unlocks the whole
    // family, checked here by keying RevenueCat's identity to the family itself.
    await Purchases.configure({ apiKey, appUserID: familyId })
    configured = true
  } catch (e) {
    console.error('RevenueCat configure failed:', e)
  }
}

export function isRevenueCatReady() {
  return configured
}

export async function getCurrentOffering() {
  if (!configured) return null
  try {
    const offerings = await Purchases.getOfferings()
    return offerings.current
  } catch (e) {
    console.error('RevenueCat getOfferings failed:', e)
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
