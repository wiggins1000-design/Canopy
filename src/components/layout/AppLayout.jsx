import { Outlet, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useFamily } from '../../context/FamilyContext'
import { supabase } from '../../lib/supabase'
import OnboardingPage from '../../pages/OnboardingPage'
import PaywallOverlay from '../subscription/PaywallOverlay'
import { useSubscription } from '../../hooks/useSubscription'
import { isNativePlatform, registerNativePush } from '../../lib/supabase'
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

// Shown when a native push notification is tapped — since iOS/Android both
// dismiss the notification from the system list the moment it's tapped, and
// tapping just deep-links into a page with no other trace of what the
// notification actually said, this surfaces the title/body briefly in-app
// so it isn't lost the instant you act on it.
function PushNotificationToast({ title, body, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 7000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed top-4 left-4 right-4 z-50 bg-canopy-deep text-white rounded-2xl shadow-lg px-4 py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold truncate">{title}</p>}
        {body && <p className="text-sm text-canopy-mist mt-0.5">{body}</p>}
      </div>
      <button onClick={onDone} className="text-canopy-mist hover:text-white shrink-0 p-0.5" aria-label="Dismiss">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function AppLayoutInner({ showSuccessToast, onToastDone, showPlanImportedToast, onPlanToastDone }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { member } = useFamily()
  const [pushToast, setPushToast] = useState(null)

  useEffect(() => { initNativeStatusBar() }, [])

  // Tapping a native push notification should deep-link to whatever page it's
  // about (e.g. Calendar for the evening reminder), not just resume the app
  // wherever it happened to be left open. Also surface the notification's own
  // content as a toast — both platforms clear it from the system notification
  // list the instant it's tapped, so without this its content is lost right
  // when you act on it.
  useEffect(() => {
    if (!isNativePlatform()) return
    let handle
    ;(async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      handle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const { title, body, data } = action.notification ?? {}
        if (title || body) setPushToast({ title, body })
        if (data?.url) navigate(data.url)
      })
    })()
    return () => { handle?.remove() }
  }, [navigate])

  // WhatsApp (or any app) share-sheet support: a share can arrive either
  // before the app was running (cold launch -- pulled via getPendingShare(),
  // since a live listener attached after the fact would miss it) or while
  // already running (warm launch -- live shareReceived listener). See
  // src/native/canopyShare.js and android/.../CanopySharePlugin.java /
  // ios/.../CanopySharePlugin.swift for the native side.
  useEffect(() => {
    if (!isNativePlatform()) return
    let handle
    ;(async () => {
      const { default: CanopyShare, PENDING_SHARE_KEY } = await import('../../native/canopyShare')
      // Always clears the native side's pending-share state as its first step,
      // regardless of whether delivery came via the pull below or the live
      // listener -- otherwise a share delivered live (listener fires, this
      // runs) leaves the native static field still set, and a later remount's
      // getPendingShare() pull would redeliver + reprocess the same share a
      // second time.
      const stash = async (share) => {
        if (!share) return
        await CanopyShare.clearPendingShare()
        sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(share))
        navigate('/add-from-share')
      }
      const { share } = await CanopyShare.getPendingShare()
      if (share) stash(share)
      handle = await CanopyShare.addListener('shareReceived', stash)
      // The debug-trail alert used to live here, but this effect only runs once
      // AppLayout has cleared auth/family loading -- during the white-screen
      // hang it never fired at all, which was a diagnostic dead end. Moved to
      // AppLinksHandler (App.jsx), which mounts unconditionally and immediately,
      // so the next test tells us whether the hang is before or after this point.
    })()
    return () => { handle?.remove() }
  }, [navigate])

  // App Links routing (getLaunchUrl/appUrlOpen) lives in AppLinksHandler at the
  // top of App.jsx, not here — it needs to run for logged-out visitors too (e.g.
  // a brand-new invitee tapping a /join/:code link), and this component is
  // nested behind ProtectedRoute, which never mounts for them.

  // Firebase/Apple periodically rotate push tokens in the background — this
  // is normal, but our stored token silently goes stale unless something
  // re-registers to pick up the new one. Only re-registering is triggered by
  // the user manually toggling push on in Settings, which most people never
  // touch again after the first time. So: silently re-register on each app
  // launch for anyone who already has push enabled (their platform column is
  // already set), so a rotated token gets refreshed before it ever causes a
  // real "notifications just stopped" complaint. registerNativePush()'s
  // permission check is a no-op (no prompt shown) once already granted or
  // denied, so this is safe to call unprompted.
  useEffect(() => {
    if (!isNativePlatform() || !member || !user) return
    ;(async () => {
      const { Capacitor } = await import('@capacitor/core')
      const column = Capacitor.getPlatform() === 'ios' ? 'push_token_ios' : 'push_token_android'
      if (member[column]) registerNativePush(user.id)
    })()
    // Only on initial load of this session, not every time member refetches
    // (which would otherwise re-fire on every token write this effect itself
    // causes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!member, user?.id])

  return (
    <div className="h-dvh bg-gray-50 flex flex-col overflow-hidden">
      {showSuccessToast && <SubscriptionSuccessToast onDone={onToastDone} />}
      {showPlanImportedToast && <PlanImportedToast onDone={onPlanToastDone} />}
      {pushToast && <PushNotificationToast {...pushToast} onDone={() => setPushToast(null)} />}
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
