import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../context/FamilyContext'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'

export default function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { session, signInWithEmail, signUpWithEmail, signOut } = useAuth()
  const { family, joinFamily, loading: familyLoading } = useFamily()

  const [mode, setMode] = useState('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // Android's WebView never reliably reports the on-screen keyboard as a
  // viewport change (adjustResize, the Keyboard plugin's own body-resize mode,
  // and scrollIntoView alone all failed identically on-device) — so instead of
  // trusting anything the browser infers about "visible area", get the real
  // keyboard height straight from Android's own APIs via the Keyboard plugin's
  // events and use it as genuine extra scroll space at the bottom of the form.
  // iOS's native resize already handles this correctly on its own (always did,
  // until capacitor.config.json briefly set resize:"none" globally on 2026-07-19
  // and broke it there too) — scoped to Android only so iOS isn't double-padded
  // on top of its own native resize.
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
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
    if (error) { setError(error.message); setJoining(false) }
    // On success FamilyContext reloads → family is set → first effect navigates away
  }

  // Signup/signin + join used to be wired together only through reactive state
  // (signUp() resolving → wait for onAuthStateChange to update `session` → wait
  // for FamilyContext's effect to notice the new user → loadFamily → wait for
  // another effect to auto-join → loadFamily again → wait for a third effect to
  // navigate). That's five separate async hops across two contexts, each hoping
  // to fire in the right order — fragile, and it never actually got the join code
  // right at least once on Android (the "flash back to the form" investigation
  // from 2026-07-19, unresolved after ~6 hours). Replaced with a single linear
  // sequence: the Supabase client's own internal session is already valid the
  // instant signUp()/signInWithPassword() resolves (that's what triggers
  // onAuthStateChange in the first place) — so the join RPC can be called
  // directly right here without waiting for React state to catch up at all.
  // Calling supabase.rpc() directly (not FamilyContext's joinFamily helper)
  // deliberately avoids a stale-closure trap: joinFamily's internal loadFamily
  // is a useCallback bound to whatever `user` was in scope on this component's
  // last render before submit — i.e. still null for a brand-new signup — so
  // calling it here would silently no-op instead of fetching anything.
  async function handleAuth(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { error: authError } = mode === 'signin'
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password, name)
      if (authError) throw new Error(authError.message)

      const { error: joinError } = await supabase.rpc('join_family', { p_code: code.toUpperCase() })
      if (joinError) {
        throw new Error(joinError.message?.includes('invalid_or_expired_invite')
          ? 'Invalid or expired invite code'
          : joinError.message)
      }

      // Deliberately a hard reload, not navigate(): by this point `user` in
      // FamilyContext already updated once (from the signUp/signIn call above)
      // and its loadFamily() already ran and found nothing, since it fired
      // before this join RPC had committed. Nothing re-triggers loadFamily
      // afterward — calling FamilyContext's own reload()/joinFamily() here
      // would hit the same stale-closure trap noted above. A full reload
      // reinitializes both contexts from scratch against the now-current DB
      // state instead, so `family` is never seen as stale-null within this
      // session (which previously showed as a false "invalid or expired
      // invite" if the user ever re-landed on this page in the same session,
      // since the join had already gone through and the code was correctly
      // marked used).
      window.location.href = '/calendar'
    } catch (err) {
      setError(err.message)
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
          <div className="bg-canopy-frost border border-canopy-mist rounded-xl px-4 py-2.5 mb-5 text-center">
            <p className="text-xs text-canopy-green font-semibold uppercase tracking-wide">Invite code</p>
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
