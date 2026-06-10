import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../context/FamilyContext'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'

export default function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { session, signInWithEmail, signUpWithEmail } = useAuth()
  const { family, joinFamily, loading: familyLoading } = useFamily()

  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState(null)

  // Already in a family — go straight to the app
  useEffect(() => {
    if (session && !familyLoading && family) {
      navigate('/calendar', { replace: true })
    }
  }, [session, family, familyLoading, navigate])

  // Logged in but no family — auto-join with the code
  useEffect(() => {
    if (session && !familyLoading && !family && code && !joining) {
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

  async function handleAuth(e) {
    e.preventDefault()
    setError(null)
    setAuthLoading(true)
    if (mode === 'signin') {
      const { error } = await signInWithEmail(email, password)
      if (error) setError(error.message)
    } else {
      const { error } = await signUpWithEmail(email, password, name)
      if (error) setError(error.message)
    }
    setAuthLoading(false)
  }

  // Loading while session or family resolves
  if (session === undefined || (session && familyLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Logged in, no family yet — show joining state
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
              <Button onClick={doJoin}>Try again</Button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  // Not logged in — show auth form
  return (
    <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/logo.png" alt="Canopy" className="h-12" />
          </div>
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
                onClick={() => { setMode(m); setError(null) }}
                className={[
                  'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
                ].join(' ')}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {mode === 'signup' && (
              <Field label="Your name" type="text" value={name} onChange={setName} placeholder="e.g. Sarah" required />
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" required />
            <PasswordField label="Password" value={password} onChange={setPassword} placeholder="••••••••" required />
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>
            )}
            <Button type="submit" className="w-full py-3" loading={authLoading}>
              {mode === 'signin' ? 'Sign in & join' : 'Create account & join'}
            </Button>
          </form>
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
        className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
      />
    </div>
  )
}
