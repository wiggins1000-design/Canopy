import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, registerPushSubscription } from '../lib/supabase'
import { callFlush } from '../lib/sessionFlushRegistry'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [user, setUser] = useState(null)
  const [needsTwoFa, setNeedsTwoFa] = useState(false)

  // Ref-based flag to hold the session during 2FA checking.
  // Using a ref (not state) means the onAuthStateChange handler sees the up-to-date
  // value synchronously, preventing any intermediate render exposing the session
  // before we know whether 2FA is required.
  const holdingSessionFor2FA = useRef(false)
  const heldSession = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && holdingSessionFor2FA.current) {
        // A fresh login is in progress and we're checking 2FA — hold the session.
        heldSession.current = session
        return
      }

      setSession(session)
      setUser(session?.user ?? null)

      if (event === 'SIGNED_OUT') {
        setNeedsTwoFa(false)
        heldSession.current = null
      }

      if (session?.user && event !== 'PASSWORD_RECOVERY') {
        registerPushSubscription(session.user.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithEmail(email, password) {
    holdingSessionFor2FA.current = true

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      holdingSessionFor2FA.current = false
      return { error }
    }

    // Check whether 2FA is needed for this user.
    // Both state updates below are in the same synchronous block so React 18
    // batches them into a single render — no flash between session and 2FA gate.
    let needs2FA = false
    try {
      const { data: settings } = await supabase
        .from('app_settings')
        .select('two_fa_enabled')
        .single()

      if (settings?.two_fa_enabled) {
        const { data: memberData } = await supabase
          .from('family_members')
          .select('two_fa_enabled')
          .eq('user_id', data.user.id)
          .maybeSingle()
        needs2FA = !!memberData?.two_fa_enabled
      }
    } catch {
      // On any error, proceed without 2FA
    }

    holdingSessionFor2FA.current = false

    // Release the session that was held during the check
    const sess = heldSession.current ?? data.session
    heldSession.current = null

    // Both updates are batched by React 18 — LoginPage sees both simultaneously
    if (needs2FA) setNeedsTwoFa(true)
    setSession(sess)
    setUser(sess?.user ?? null)
    if (sess?.user) registerPushSubscription(sess.user.id)

    return { error: null, needsTwoFa: needs2FA }
  }

  async function signUpWithEmail(email, password, displayName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    return { data, error }
  }

  async function resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    return { error }
  }

  async function signOut() {
    await callFlush()
    await supabase.auth.signOut()
  }

  function completeTwoFa() {
    setNeedsTwoFa(false)
  }

  async function sendTwoFaCode() {
    const { error } = await supabase.functions.invoke('send-2fa-code', { body: {} })
    return { error }
  }

  async function verifyTwoFaCode(code) {
    const { data, error } = await supabase.functions.invoke('verify-2fa-code', { body: { code } })
    return { verified: !!data?.verified, error }
  }

  return (
    <AuthContext.Provider value={{
      session, user,
      needsTwoFa, completeTwoFa,
      sendTwoFaCode, verifyTwoFaCode,
      signInWithEmail, signUpWithEmail, resetPasswordForEmail, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
