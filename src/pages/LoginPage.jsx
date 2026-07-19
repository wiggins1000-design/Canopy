import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import { isNativePlatform } from '../lib/supabase'

export default function LoginPage() {
  const { session, needsTwoFa, signInWithEmail, signUpWithEmail, resetPasswordForEmail } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(location.state?.message ?? null)

  if (session && !needsTwoFa) return <Navigate to="/calendar" replace />
  if (session && needsTwoFa) return <Navigate to="/2fa" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    if (mode === 'signin') {
      const { error } = await signInWithEmail(email, password)
      if (error) setError(error.message)
    } else if (mode === 'signup') {
      const { error } = await signUpWithEmail(email, password, name)
      if (error) setError(error.message)
      else setSuccess('Check your email to confirm your account, then sign in.')
    } else if (mode === 'forgot') {
      const { error } = await resetPasswordForEmail(email)
      if (error) setError(error.message)
      else setSuccess('Check your email for a password reset link.')
    }
    setLoading(false)
  }

  function switchMode(m) {
    setMode(m)
    setError(null)
    setSuccess(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center px-6 pt-[82px] pb-12 overflow-y-auto">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-4">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/CanopyWhiteLogo.gif" alt="Canopy" className="h-12" />
          </div>
          <p className="text-gray-500 text-sm">Share what matters.</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {mode === 'forgot' ? (
            <>
              <button onClick={() => switchMode('signin')} className="text-sm text-canopy-mid flex items-center gap-1 mb-4">
                ← Back to sign in
              </button>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Reset your password</h2>
              <p className="text-xs text-gray-400 mb-4">Enter your email and we'll send a reset link.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" required />
                {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>}
                {success && <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700">{success}</div>}
                {!success && (
                  <Button type="submit" className="w-full py-3" loading={loading}>Send reset link</Button>
                )}
              </form>
            </>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
                {['signin', 'signup'].map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMode(m)}
                    className={[
                      'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
                      mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
                    ].join(' ')}
                  >
                    {m === 'signin' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <Field label="Your name" type="text" value={name} onChange={setName} placeholder="e.g. Sarah" required />
                )}
                <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" required />
                <PasswordField label="Password" value={password} onChange={setPassword} placeholder="••••••••" required />

                {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>}
                {success && <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700">{success}</div>}

                <Button type="submit" className="w-full py-3 mt-2" loading={loading}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </Button>

                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-xs text-gray-400 hover:text-gray-600 w-full text-center"
                  >
                    Forgot password?
                  </button>
                )}
              </form>
            </>
          )}
        </div>

        {/* Store badges — only meaningful on the web version (neither app is publicly
            live yet, both marked "coming soon"). Pointless — and confusing — inside
            a native build someone already has installed, so hidden there. */}
        {!isNativePlatform() && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <StoreBadge icon={<AppleIcon />} label="App Store" />
            <StoreBadge icon={<PlayIcon />} label="Google Play" />
          </div>
        )}
      </div>
    </div>
  )
}

function StoreBadge({ icon, label }) {
  return (
    <div className="flex items-center gap-2 bg-white/70 border border-gray-200 rounded-xl px-3.5 py-2 text-gray-400">
      {icon}
      <div className="leading-tight">
        <p className="text-[9px] uppercase tracking-wide">Coming soon</p>
        <p className="text-xs font-semibold text-gray-500">{label}</p>
      </div>
    </div>
  )
}

function AppleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
      <path d="M16.365 1.43c0 1.14-.462 2.253-1.156 3.03-.756.845-2.02 1.49-3.05 1.49-.127 0-.253-.02-.34-.033-.014-.113-.033-.253-.033-.4 0-1.14.516-2.302 1.18-3.07.802-.906 2.117-1.55 3.19-1.6.02.19.02.33.02.4zM20.5 17.34c-.42.973-.63 1.407-1.176 2.267-.766 1.196-1.844 2.686-3.18 2.7-1.185.013-1.49-.77-3.098-.76-1.608.01-1.943.774-3.128.76-1.336-.014-2.357-1.36-3.123-2.556-2.14-3.343-2.364-7.267-1.044-9.36.937-1.487 2.418-2.36 3.812-2.36 1.418 0 2.31.774 3.482.774 1.137 0 1.828-.774 3.464-.774 1.24 0 2.554.677 3.49 1.846-3.067 1.68-2.57 6.05.5 7.463z"/>
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
      <path d="M3.6 2.24c-.34.34-.54.86-.54 1.53v16.46c0 .67.2 1.19.54 1.53l.1.08L13.03 12v-.24L3.7 2.16l-.1.08z"/>
      <path d="M16.1 15.1l-3.07-3.07V12v-.24l3.07-3.07 6.94 3.94c.94.53.94 1.4 0 1.93l-6.94 3.94z"/>
      <path d="M13.03 12L3.7 21.76c.34.36.9.4 1.53.06l10.87-6.18-3.07-3.64z"/>
      <path d="M13.03 12l3.07-3.64L5.23 2.18c-.63-.35-1.19-.3-1.53.06L13.03 12z"/>
    </svg>
  )
}

function Field({ label, type, value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
      />
    </div>
  )
}
