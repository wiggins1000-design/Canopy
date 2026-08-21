import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../context/FamilyContext'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import { friendlyAuthError } from '../lib/supabase'

export default function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { session, signInWithEmail, signUpWithEmail, signOut } = useAuth()
  const familyCtx = useFamily()
  const { family, joinFamily, loading: familyLoading } = familyCtx

  // handleAuth spans an await over signup/signin, during which FamilyContext
  // re-renders once `user` updates and produces a freshly-bound joinFamily
  // (its useCallback depends on [user]) — but handleAuth's own closure,
  // captured at the render before that async function started, still holds
  // the OLD joinFamily bound to user=null. A ref always mirrors the latest
  // render's context value, so reading familyCtxRef.current after the await
  // gets the freshly-bound version instead of the stale one.
  //
  // Confirmed by debug logging that this alone isn't sufficient: GoTrue's
  // onAuthStateChange fires before signUp()'s own promise resolves, but that
  // only means React's setState calls have been *made* by that point, not
  // that React has actually committed the resulting re-render and run this
  // ref-updating effect yet — that happens on its own scheduled tick, which
  // handleAuth's continuation can race ahead of. Reading familyCtxRef.current
  // immediately after the signUp await genuinely still got the stale
  // pre-signup value in testing (joinFamily's RPC call succeeded regardless,
  // since that doesn't depend on the closure — but its internal loadFamily()
  // call did, and silently reset family back to null seeing the stale
  // user=null). sessionRef + waitForSession() below forces a wait for at
  // least one real committed render reflecting the new session before
  // touching familyCtxRef at all, since AuthContext and FamilyContext update
  // together in the same render pass.
  const familyCtxRef = useRef(familyCtx)
  useEffect(() => { familyCtxRef.current = familyCtx })

  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session })

  async function waitForSession(timeoutMs = 5000) {
    const start = Date.now()
    while (!sessionRef.current) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for session to update after sign in.')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  const [mode, setMode] = useState('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // Neither platform's WebView reliably reports the on-screen keyboard as a
  // viewport change (adjustResize, the Keyboard plugin's own body-resize mode,
  // and scrollIntoView alone all failed identically on Android; iOS's native
  // resize mode does technically work, but shrinking the WKWebView frame for
  // it exposes a black gap behind it that two separate fixes couldn't paint
  // over — confirmed on-device even after a full delete+reinstall, so the
  // gap itself is inherent to native resize on this app, not a caching
  // artifact). Both platforms now use resize:"none" (capacitor.config.json)
  // and this same JS-driven approach instead: get the real keyboard height
  // straight from the OS's own APIs via the Keyboard plugin's events, and
  // use it as genuine extra scroll space at the bottom of the form.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let showHandle, hideHandle
    ;(async () => {
      const { Keyboard } = await import('@capacitor/keyboard')
      showHandle = await Keyboard.addListener('keyboardWillShow', (info) => {
        setKeyboardHeight(info.keyboardHeight)
      })
      hideHandle = await Keyboard.addListener('keyboardWillHide', () => {
        setKeyboardHeight(0)
      })
    })()
    return () => { showHandle?.remove(); hideHandle?.remove() }
  }, [])

  // Already in a family (e.g. reopening the invite link after already having
  // joined) — go straight to the app. This only ever applies to an already-
  // settled session on mount, never concurrently with handleAuth's own submit
  // flow below, so it doesn't race with it.
  useEffect(() => {
    if (session && !familyLoading && family) {
      navigate('/calendar', { replace: true })
    }
  }, [session, family, familyLoading, navigate])

  // Already logged in (from an earlier session) but not yet in this family —
  // auto-join with the code. Guarded on !submitting so it can't fire
  // concurrently with handleAuth's own join call below for the fresh
  // signup/signin case.
  useEffect(() => {
    if (session && !familyLoading && !family && code && !joining && !submitting) {
      doJoin()
    }
  }, [session, family, familyLoading])

  async function doJoin() {
    setJoining(true)
    setError(null)
    const { error } = await joinFamily(code.toUpperCase())
    if (error) { setError(friendlyAuthError(error.message)); setJoining(false) }
    // On success FamilyContext reloads → family is set → first effect navigates away
  }

  // Signup/signin + join used to be wired together only through reactive state
  // (signUp() resolving → wait for onAuthStateChange to update `session` → wait
  // for FamilyContext's effect to notice the new user → loadFamily → wait for
  // another effect to auto-join → loadFamily again → wait for a third effect to
  // navigate). That's five separate async hops across two contexts, each hoping
  // to fire in the right order — fragile, and it never actually got the join code
  // right at least once on Android (the "flash back to the form" investigation
  // from 2026-07-19, unresolved after ~6 hours).
  //
  // First replacement attempt called the join RPC directly via supabase.rpc(),
  // bypassing FamilyContext's own joinFamily entirely to dodge the stale-closure
  // problem described above familyCtxRef — but that meant nothing ever told
  // FamilyContext to refresh afterward, so `family` stayed stale-null for the
  // rest of the session (a false "invalid or expired invite" if the user ever
  // re-landed on this page), which then got "fixed" with a hard
  // window.location reload — which repeatedly broke on native instead, since
  // neither '/calendar' nor this page's own URL is a real file the Capacitor
  // WebView's local server can serve on a raw browser-level navigation (only
  // React Router's client-side routing resolves those, and that doesn't exist
  // yet before index.html has booted). Confirmed on-device 3 separate times:
  // signup+join always succeeded correctly server-side, but the client hung on
  // a blank screen every time regardless of which path was reloaded to.
  //
  // Proven working alternative: OnboardingPage's own "join with an invite
  // code" step calls FamilyContext's joinFamily() directly and needs no
  // navigation at all, because it's already inside the same always-mounted
  // app shell (AppLayout swaps it out for the real app the instant `family`
  // becomes truthy — plain conditional rendering, no route change) — this
  // works reliably on native. The real fix here is to get JoinPage back to
  // that same plain-navigate mechanism, by actually fixing the stale-closure
  // problem (via familyCtxRef, see above) instead of routing around it.
  async function handleAuth(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { error: authError } = mode === 'signin'
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password, name)
      if (authError) throw new Error(authError.message)

      await waitForSession()
      const { error: joinError } = await familyCtxRef.current.joinFamily(code.toUpperCase())
      if (joinError) {
        throw new Error(joinError.message?.includes('invalid_or_expired_invite')
          ? 'Invalid or expired invite code'
          : joinError.message)
      }

      // joinFamily() (the freshly-bound one via the ref) internally reloads
      // FamilyContext's family/member state before resolving — `family`
      // becomes truthy, and the "already in family" effect above navigates
      // client-side. No explicit navigate/reload needed here at all.
    } catch (err) {
      setError(friendlyAuthError(err.message))
      setSubmitting(false)
    }
  }

  // Still checking for an existing session
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Existing session, family still loading
  if (session && familyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Existing session, no family yet — show joining state (handles the
  // already-logged-in-elsewhere case via the auto-join effect above)
  if (session && !family) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          {joining ? (
            <>
              <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Joining family…</p>
            </>
          ) : error ? (
            <>
              <p className="text-sm text-red-600">{error}</p>
              {/* Retrying the same code from an invalid/expired/already-used
                  error would just fail identically forever — send them
                  somewhere they can actually enter a different one instead.
                  AppLayout shows OnboardingPage's "Join with an invite code"
                  step for an authenticated user with no family, which is
                  still true here. */}
              <Button onClick={() => navigate('/calendar', { replace: true })}>Enter a different code</Button>
              <button
                type="button"
                onClick={() => signOut()}
                className="block mx-auto text-sm text-gray-400 hover:text-gray-600 mt-2"
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  // Existing session with a family — the effect above is about to navigate
  // away; render nothing in the meantime rather than flashing the form
  if (session && family) return null

  // Not logged in — show auth form
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center px-6 pt-[82px] overflow-y-auto"
      style={{ paddingBottom: keyboardHeight ? `${keyboardHeight + 48}px` : '48px' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/CanopyWhiteLogo.gif" alt="Canopy" className="h-12" />
          </div>
          <p className="text-gray-500 text-sm mb-2">Share what matters.</p>
          <h2 className="text-lg font-semibold text-gray-700">You've been invited</h2>
          <p className="text-gray-500 mt-1 text-sm">Sign in or create an account to join Canopy.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 mb-5 text-center">
            <p className="text-xs text-canopy-mid font-semibold uppercase tracking-wide">Invite code</p>
            <p className="font-mono text-xl font-bold text-canopy-deep tracking-widest mt-0.5">{code?.toUpperCase()}</p>
          </div>

          <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
            {['signin', 'signup'].map((m) => (
              <button
                key={m}
                type="button"
                disabled={submitting}
                onClick={() => { setMode(m); setError(null) }}
                className={[
                  'flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50',
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
                ].join(' ')}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleAuth}
            className="space-y-4"
            onFocus={(e) => {
              // Don't rely on the WebView correctly resizing the viewport for the
              // on-screen keyboard (adjustResize + the Keyboard plugin's body-resize
              // mode have both proven unreliable here on-device) — instead directly
              // scroll whichever field was just focused into view. Delayed to let
              // the keyboard's own show animation finish first, since scrolling
              // immediately measures against the pre-keyboard layout.
              const target = e.target
              if (target.tagName === 'INPUT') {
                setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
              }
            }}
          >
            {mode === 'signup' && (
              <Field label="Your name" type="text" value={name} onChange={setName} placeholder="e.g. Sarah" required disabled={submitting} />
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" required disabled={submitting} />
            <PasswordField label="Password" value={password} onChange={setPassword} placeholder="••••••••" required disabled={submitting} />
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>
            )}
            <Button type="submit" className="w-full py-3" loading={submitting}>
              {mode === 'signin' ? 'Sign in & join' : 'Create account & join'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, type, value, onChange, placeholder, required, disabled }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green disabled:opacity-50"
      />
    </div>
  )
}
