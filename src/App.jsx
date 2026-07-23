import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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

// Chunk URLs are content-hashed per deploy — if a tab has been open across a
// Railway deploy, its already-loaded index.html can still point at a chunk
// hash the server no longer has, and the dynamic import 404s. That's a dead
// end for React.lazy (the failure isn't retryable), so catch it once and force
// a full reload to pick up the current index.html/hashes rather than leaving
// the user stuck on a broken render.
const RELOAD_FLAG = 'canopy-chunk-reload'
function lazyWithReload(componentImport) {
  return lazy(async () => {
    try {
      const mod = await componentImport()
      sessionStorage.removeItem(RELOAD_FLAG)
      return mod
    } catch (error) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
        return new Promise(() => {}) // page is reloading, never resolve
      }
      throw error
    }
  })
}

// Everything else is lazy — only downloaded when the user navigates to it
const AdminLoginPage      = lazyWithReload(() => import('./pages/admin/AdminLoginPage'))
const AdminDashboardPage  = lazyWithReload(() => import('./pages/admin/AdminDashboardPage'))
const AdminFamilyPage     = lazyWithReload(() => import('./pages/admin/AdminFamilyPage'))
const AdminTermDatesPage  = lazyWithReload(() => import('./pages/admin/AdminTermDatesPage'))
const AdminFamilyFeedPage = lazyWithReload(() => import('./pages/admin/AdminFamilyFeedPage'))
const AdminBroadcastPage  = lazyWithReload(() => import('./pages/admin/AdminBroadcastPage'))
const AdminClaudeCostsPage = lazyWithReload(() => import('./pages/admin/AdminClaudeCostsPage'))
const CalendarPage        = lazyWithReload(() => import('./pages/CalendarPage'))
const NoticeBoardPage     = lazyWithReload(() => import('./pages/NoticeBoardPage'))
const MediaPage           = lazyWithReload(() => import('./pages/MediaPage'))
const ConfigPage          = lazyWithReload(() => import('./pages/ConfigPage'))
const InvitePage          = lazyWithReload(() => import('./pages/InvitePage'))
const RequestsPage        = lazyWithReload(() => import('./pages/RequestsPage'))
const InfoBankPage        = lazyWithReload(() => import('./pages/InfoBankPage'))
const ExportPage          = lazyWithReload(() => import('./pages/ExportPage'))
const MessagesPage        = lazyWithReload(() => import('./pages/MessagesPage'))
const ThreadPage          = lazyWithReload(() => import('./pages/ThreadPage'))
const ExpensesPage        = lazyWithReload(() => import('./pages/ExpensesPage'))
const ChildcarePage       = lazyWithReload(() => import('./pages/ChildcarePage'))
const PlanPage            = lazyWithReload(() => import('./pages/PlanPage'))
const AddFromSharePage    = lazyWithReload(() => import('./pages/AddFromSharePage'))

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
  // DIAGNOSTIC MODE (2026-07-23round2, remove alongside the other diagnostic
  // code once the white-screen hang is confirmed fixed): the debug alert
  // below (window.alert()) has never once appeared across every white-screen
  // repro so far, even on builds where the share extension's own debug trail
  // confirms it wrote real debug text into the App Group. That's ambiguous on
  // its own -- it could mean React never gets this far during a share-
  // triggered launch (something upstream: WebView/bridge), OR it could mean
  // this effect DOES run but window.alert() silently fails to present because
  // the WKWebView's window isn't in a state WKUIDelegate can show a native
  // dialog from yet (a known timing pitfall, unrelated to whether the JS
  // itself ran). Rendering directly into the page sidesteps that ambiguity
  // entirely -- it'll show up the instant React paints anything, with no
  // dependency on native dialog presentation timing.
  const [diagText, setDiagText] = useState('JS booted, checking for share debug…')
  // Android's singleTask launch mode (AndroidManifest.xml) can redeliver the
  // original launch intent as a fresh appUrlOpen event when the activity
  // resumes from background — with this listener mounted for the entire app
  // lifetime, that silently force-navigates back to the original invite link
  // at unpredictable moments, overriding any in-app navigation the user just
  // did (confirmed on-device: tapping a button elsewhere in the app to
  // navigate away from a stale invite link's error page bounced straight
  // back to it with no visible transition). Dedupe consecutive identical
  // URLs so a redelivered event for the same link is a no-op.
  const lastUrlRef = useRef(null)

  useEffect(() => {
    if (!isNativePlatform()) return
    let handle
    const routeFromUrl = (urlString) => {
      if (!urlString || urlString === lastUrlRef.current) return
      try {
        const { pathname, search } = new URL(urlString)
        if (pathname && pathname !== '/') {
          lastUrlRef.current = urlString
          navigate(pathname + search)
        }
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

  useEffect(() => {
    if (!isNativePlatform()) { setDiagText(null); return }
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'ios') { setDiagText(null); return }
        const { default: CanopyShare } = await import('./native/canopyShare')
        if (!CanopyShare.getShareDebug) { setDiagText('no getShareDebug method on plugin'); return }
        setDiagText('calling getShareDebug()…')
        const { debug } = await CanopyShare.getShareDebug()
        setDiagText(debug ? `share debug: ${debug}` : 'JS booted, no share debug found')
      } catch (err) {
        setDiagText(`getShareDebug threw: ${err?.message ?? String(err)}`)
      }
    })()
  }, [])

  return diagText ? (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#1b4332', color: 'white', fontSize: 11, padding: '4px 8px', wordBreak: 'break-word' }}>
      {diagText}
    </div>
  ) : null
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
