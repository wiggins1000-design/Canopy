import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { FamilyProvider } from './context/FamilyContext'
import { SessionActivityProvider } from './context/SessionActivityContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import AdminRoute from './components/admin/AdminRoute'
import AdminLayout from './components/admin/AdminLayout'
import { isNativePlatform } from './lib/supabase'

// Auth + join pages load eagerly — they're on the critical path before the app shell
import LoginPage from './pages/LoginPage'
import TwoFAPage from './pages/TwoFAPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import JoinPage from './pages/JoinPage'

// Everything else is lazy — only downloaded when the user navigates to it
const AdminLoginPage      = lazy(() => import('./pages/admin/AdminLoginPage'))
const AdminDashboardPage  = lazy(() => import('./pages/admin/AdminDashboardPage'))
const AdminFamilyPage     = lazy(() => import('./pages/admin/AdminFamilyPage'))
const AdminTermDatesPage  = lazy(() => import('./pages/admin/AdminTermDatesPage'))
const AdminFamilyFeedPage = lazy(() => import('./pages/admin/AdminFamilyFeedPage'))
const AdminBroadcastPage  = lazy(() => import('./pages/admin/AdminBroadcastPage'))
const AdminClaudeCostsPage = lazy(() => import('./pages/admin/AdminClaudeCostsPage'))
const CalendarPage        = lazy(() => import('./pages/CalendarPage'))
const NoticeBoardPage     = lazy(() => import('./pages/NoticeBoardPage'))
const MediaPage           = lazy(() => import('./pages/MediaPage'))
const ConfigPage          = lazy(() => import('./pages/ConfigPage'))
const InvitePage          = lazy(() => import('./pages/InvitePage'))
const RequestsPage        = lazy(() => import('./pages/RequestsPage'))
const InfoBankPage        = lazy(() => import('./pages/InfoBankPage'))
const ExportPage          = lazy(() => import('./pages/ExportPage'))
const MessagesPage        = lazy(() => import('./pages/MessagesPage'))
const ThreadPage          = lazy(() => import('./pages/ThreadPage'))
const ExpensesPage        = lazy(() => import('./pages/ExpensesPage'))
const ChildcarePage       = lazy(() => import('./pages/ChildcarePage'))
const PlanPage            = lazy(() => import('./pages/PlanPage'))
const AddFromSharePage    = lazy(() => import('./pages/AddFromSharePage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[40vh]">
      <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// App Links: tapping an https://my.canopy-app.app/... link (e.g. an invite email,
// the urgent-notice SMS) should route straight to the intended in-app page instead
// of landing on the default entry route. Deliberately mounted here, above every
// route (including /login and /join/:code), rather than inside the authenticated
// AppLayout shell — a brand-new invitee tapping a /join/:code link has no session
// yet, so anything nested behind ProtectedRoute would never mount for them and the
// tapped link's path would be silently dropped, landing on plain LoginPage instead.
// Same cold/warm-launch split as the share-sheet handling in AppLayout — getLaunchUrl()
// for a link that started the app, addListener for one tapped while already running.
// Android side needs the autoVerify intent-filter in AndroidManifest.xml +
// public/.well-known/assetlinks.json; iOS Universal Links entitlement not yet added
// (blocked on the Apple org migration, see platform_build_status memory).
function AppLinksHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativePlatform()) return
    let handle
    const routeFromUrl = (urlString) => {
      if (!urlString) return
      try {
        const { pathname, search } = new URL(urlString)
        if (pathname && pathname !== '/') navigate(pathname + search)
      } catch { /* ignore malformed URLs */ }
    }
    ;(async () => {
      const { App: CapacitorApp } = await import('@capacitor/app')
      const launch = await CapacitorApp.getLaunchUrl()
      routeFromUrl(launch?.url)
      handle = await CapacitorApp.addListener('appUrlOpen', (data) => routeFromUrl(data.url))
    })()
    return () => { handle?.remove() }
  }, [navigate])

  return null
}

export default function App() {
  return (
    <AuthProvider>
      <FamilyProvider>
        <SessionActivityProvider>
        <AppLinksHandler />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/2fa" element={<TwoFAPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/join/:code" element={<JoinPage />} />
            <Route path="/plan" element={<PlanPage />} />

            {/* Admin — completely separate from the customer app */}
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
              <Route index element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboardPage />} />
              <Route path="family/:id" element={<AdminFamilyPage />} />
              <Route path="term-dates" element={<AdminTermDatesPage />} />
              <Route path="familyfeed" element={<AdminFamilyFeedPage />} />
              <Route path="broadcast" element={<AdminBroadcastPage />} />
              <Route path="claude-costs" element={<AdminClaudeCostsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/calendar" replace />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/board" element={<NoticeBoardPage />} />
              <Route path="/board/media" element={<MediaPage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/info" element={<InfoBankPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:threadId" element={<ThreadPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/childcare" element={<ChildcarePage />} />
              <Route path="/add-from-share" element={<AddFromSharePage />} />
            </Route>
          </Routes>
        </Suspense>
        </SessionActivityProvider>
      </FamilyProvider>
    </AuthProvider>
  )
}
