import { Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useFamily } from '../../context/FamilyContext'
import { supabase } from '../../lib/supabase'
import OnboardingPage from '../../pages/OnboardingPage'
import PaywallOverlay from '../subscription/PaywallOverlay'
import { useSubscription } from '../../hooks/useSubscription'
import { isNativePlatform } from '../../lib/supabase'
import { PLAN_IMPORTED_FLAG } from '../../lib/planImport'

async function initNativeStatusBar() {
  if (!isNativePlatform()) return
  try {
    const { Capacitor } = await import('@capacitor/core')
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // iOS's WKWebView natively supports env(safe-area-inset-top), so overlaying
    // the status bar and padding via CSS works reliably. Android's Chromium
    // WebView does not reliably report safe-area insets to CSS even with
    // Capacitor's inset-injection workaround, so instead ask Android to reserve
    // the status bar's own space rather than drawing under it.
    const isIOS = Capacitor.getPlatform() === 'ios'
    await StatusBar.setOverlaysWebView({ overlay: isIOS })
    await StatusBar.setStyle({ style: Style.Light })
    if (!isIOS) {
      // Android-only: colour the reserved status bar strip to match the app's
      // white page backgrounds instead of the plugin's default black.
      await StatusBar.setBackgroundColor({ color: '#ffffff' })
    }
  } catch (_) {}
}

function SubscriptionSuccessToast({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-canopy-deep text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg">
      Subscription active — welcome to Canopy!
    </div>
  )
}

function PlanImportedToast({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-canopy-deep text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg">
      Imported your children and schedule from your parenting plan ✓
    </div>
  )
}

function AppLayoutInner({ showSuccessToast, onToastDone, showPlanImportedToast, onPlanToastDone }) {
  useEffect(() => { initNativeStatusBar() }, [])

  return (
    <div className="h-dvh bg-gray-50 flex flex-col overflow-hidden">
      {showSuccessToast && <SubscriptionSuccessToast onDone={onToastDone} />}
      {showPlanImportedToast && <PlanImportedToast onDone={onPlanToastDone} />}
      <PaywallOverlay />
      <main className="flex-1 max-w-lg mx-auto w-full overflow-y-auto overflow-x-hidden min-h-0" style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))' }}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

export default function AppLayout() {
  const { user } = useAuth()
  const { family, loading, reload } = useFamily()
  const [isAdmin, setIsAdmin] = useState(null)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [showPlanImportedToast, setShowPlanImportedToast] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(!!data))
  }, [user])

  useEffect(() => {
    if (!family) return
    if (localStorage.getItem(PLAN_IMPORTED_FLAG)) {
      localStorage.removeItem(PLAN_IMPORTED_FLAG)
      setShowPlanImportedToast(true)
    }
  }, [family])

  if (loading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isAdmin) return <Navigate to="/admin/dashboard" replace />

  if (!family) return <OnboardingPage />

  return (
    <AppLayoutInner
      showSuccessToast={showSuccessToast}
      onToastDone={() => setShowSuccessToast(false)}
      showPlanImportedToast={showPlanImportedToast}
      onPlanToastDone={() => setShowPlanImportedToast(false)}
    />
  )
}
