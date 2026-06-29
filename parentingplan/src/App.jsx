import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { usePlanSave } from './hooks/usePlanSave'

const PlanPage    = lazy(() => import('./pages/PlanPage'))
const JoinPage    = lazy(() => import('./pages/JoinPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#f4fbf4]">
      <div className="w-7 h-7 border-4 border-[#52b788] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppRoutes() {
  const { planId, saving } = usePlanSave()
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/"     element={<LandingPage />} />
        <Route path="/plan" element={<PlanPage planId={planId} planSaving={saving} />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/*"    element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return <AppRoutes />
}
