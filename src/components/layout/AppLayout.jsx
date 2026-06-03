import { Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useFamily } from '../../context/FamilyContext'
import { supabase } from '../../lib/supabase'
import OnboardingPage from '../../pages/OnboardingPage'

export default function AppLayout() {
  const { user } = useAuth()
  const { family, loading } = useFamily()
  const [isAdmin, setIsAdmin] = useState(null)

  // Check if this is an admin account — if so, send them to the admin area
  useEffect(() => {
    if (!user) return
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(!!data))
  }, [user])

  if (loading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isAdmin) return <Navigate to="/admin/dashboard" replace />

  // No family yet — show onboarding
  if (!family) {
    return <OnboardingPage />
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-1 max-w-lg mx-auto w-full pb-24 overflow-x-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
