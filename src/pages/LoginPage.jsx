import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'

export default function LoginPage() {
  const { session, signInWithEmail, signUpWithEmail, resetPasswordForEmail } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(location.state?.message ?? null)

  if (session) return <Navigate to="/calendar" replace />

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
    <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/logo.png" alt="Canopy" className="h-12" />
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
      </div>
    </div>
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
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
      />
    </div>
  )
}
