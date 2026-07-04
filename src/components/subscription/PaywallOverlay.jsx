import { useState, useEffect } from 'react'
import { useSubscription } from '../../hooks/useSubscription'
import { useFamily } from '../../context/FamilyContext'
import { isNativePlatform } from '../../lib/supabase'
import { getCurrentOffering, purchasePackage, restorePurchases, hasActiveEntitlement, isRevenueCatReady } from '../../lib/revenuecat'

const FEATURES = [
  'Shared calendar with custody schedule',
  'AI email & newsletter parsing',
  'Notice board & messaging',
  'Info bank & document storage',
  'Expense tracking & receipt scanning',
  'Both parents included — one price',
]

export default function PaywallOverlay() {
  const { needsPaywall, isCancelled } = useSubscription()
  const { reload } = useFamily()
  const [offering, setOffering] = useState(null)
  const [purchasing, setPurchasing] = useState(null) // 'monthly' | 'annual' | 'restore' | null
  const [error, setError] = useState(null)
  const [unlockedLocally, setUnlockedLocally] = useState(false)

  const native = isNativePlatform()

  useEffect(() => {
    if (!needsPaywall || !native) return
    getCurrentOffering().then(setOffering)
  }, [needsPaywall, native])

  if (!needsPaywall || unlockedLocally) return null

  async function handlePurchase(pkg, key) {
    setError(null)
    setPurchasing(key)
    try {
      const customerInfo = await purchasePackage(pkg)
      if (hasActiveEntitlement(customerInfo)) {
        // Don't wait on the RevenueCat webhook round-trip to update families.subscription_status —
        // unlock immediately client-side, then quietly resync the canonical DB state in the background.
        setUnlockedLocally(true)
        reload()
      }
    } catch (e) {
      if (e?.userCancelled) { setPurchasing(null); return }
      setError('Something went wrong with the purchase. Please try again.')
      console.error('Purchase failed:', e)
    }
    setPurchasing(null)
  }

  async function handleRestore() {
    setError(null)
    setPurchasing('restore')
    try {
      const customerInfo = await restorePurchases()
      if (hasActiveEntitlement(customerInfo)) {
        setUnlockedLocally(true)
        reload()
      } else {
        setError('No active subscription found for this Apple/Google account.')
      }
    } catch (e) {
      setError('Could not restore purchases. Please try again.')
      console.error('Restore failed:', e)
    }
    setPurchasing(null)
  }

  const monthlyPkg = offering?.monthly ?? null
  const annualPkg  = offering?.annual ?? null
  const canPurchase = native && isRevenueCatReady() && (monthlyPkg || annualPkg)

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-sm mx-auto w-full">

        <div className="w-16 h-16 rounded-2xl bg-canopy-deep flex items-center justify-center mb-6 shadow-lg">
          <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          {isCancelled ? 'Subscription ended' : 'Your free trial has ended'}
        </h1>
        <p className="text-gray-500 text-center mb-8 leading-relaxed">
          Subscribe to keep your family organised with Canopy.
        </p>

        <div className="w-full space-y-3 mb-6">
          {/* Annual — highlighted */}
          <div className="rounded-3xl border-2 bg-canopy-frost p-5 relative" style={{ borderColor: '#2d6a4f' }}>
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-canopy-deep text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">Best value</span>
            <p className="text-xs font-bold text-canopy-mid uppercase tracking-widest text-center mb-2 mt-1">Annual</p>
            <div className="flex items-end justify-center gap-1 mb-0.5">
              <span className="text-5xl font-bold text-gray-900">
                {annualPkg?.product.priceString ?? '£119.99'}
              </span>
              <span className="text-gray-400 mb-1.5">/year</span>
            </div>
            <p className="text-center text-xs text-gray-400 mb-3">Both parents included</p>
            {canPurchase && annualPkg && (
              <button
                onClick={() => handlePurchase(annualPkg, 'annual')}
                disabled={purchasing !== null}
                className="w-full py-2.5 rounded-xl bg-canopy-deep text-white text-sm font-semibold disabled:opacity-50"
              >
                {purchasing === 'annual' ? 'Processing…' : 'Subscribe annually'}
              </button>
            )}
          </div>

          {/* Monthly */}
          <div className="rounded-3xl border-2 border-canopy-light bg-white p-5">
            <p className="text-xs font-bold text-canopy-mid uppercase tracking-widest text-center mb-2">Monthly</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span className="text-5xl font-bold text-gray-900">
                {monthlyPkg?.product.priceString ?? '£12.99'}
              </span>
              <span className="text-gray-400 mb-1.5">/month</span>
            </div>
            <p className="text-center text-xs text-gray-400 mb-3">Both parents included</p>
            {canPurchase && monthlyPkg && (
              <button
                onClick={() => handlePurchase(monthlyPkg, 'monthly')}
                disabled={purchasing !== null}
                className="w-full py-2.5 rounded-xl bg-white border-2 border-canopy-mid text-canopy-deep text-sm font-semibold disabled:opacity-50"
              >
                {purchasing === 'monthly' ? 'Processing…' : 'Subscribe monthly'}
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 text-center mb-4">{error}</p>}

        <ul className="w-full space-y-2.5 mb-6">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
              <svg className="w-4 h-4 text-canopy-mid mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              {f}
            </li>
          ))}
        </ul>

        {canPurchase ? (
          <button
            onClick={handleRestore}
            disabled={purchasing !== null}
            className="text-sm text-canopy-mid font-medium hover:underline disabled:opacity-50"
          >
            {purchasing === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
        ) : (
          <div className="w-full rounded-2xl bg-gray-50 border border-gray-200 px-5 py-4 text-center">
            <p className="text-sm font-semibold text-gray-700 mb-1">Subscribe via the App Store or Google Play</p>
            <p className="text-xs text-gray-400">Open the Canopy app on your phone to subscribe. Cancel anytime.</p>
          </div>
        )}
      </div>
    </div>
  )
}
