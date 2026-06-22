import { Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useFamily } from '../../context/FamilyContext'
import { supabase } from '../../lib/supabase'
import OnboardingPage from '../../pages/OnboardingPage'
import TrialBanner from '../subscription/TrialBanner'
import PaywallOverlay from '../subscription/PaywallOverlay'
import { useSubscription } from '../../hooks/useSubscription'

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

function AppLayoutInner({ showSuccessToast, onToastDone }) {
  const { needsPaywall } = useSubscription()

  return (
    <div className="h-dvh bg-gray-50 flex flex-col overflow-hidden">
      {showSuccessToast && <SubscriptionSuccessToast onDone={onToastDone} />}
      <PaywallOverlay />
      {!needsPaywall && <TrialBanner />}
      <main className="flex-1 max-w-lg mx-auto w-full overflow-y-auto overflow-x-hidden min-h-0">
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

  useEffect(() => {
    if (!user) return
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(!!data))
  }, [user])

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
    />
  )
}
