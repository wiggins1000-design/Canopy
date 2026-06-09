import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  // Supabase parses the recovery token from the URL hash automatically and
  // fires PASSWORD_RECOVERY — we wait for that before showing the form.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    await supabase.auth.signOut()
    navigate('/login', { state: { message: 'Password updated — please sign in.' } })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-canopy-mid text-white text-3xl mb-4">
            🌿
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {!ready ? (
            <p className="text-sm text-gray-500 text-center py-4">Verifying reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField label="New password" value={password} onChange={setPassword} placeholder="••••••••" required />
              <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} placeholder="••••••••" required />
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>
              )}
              <Button type="submit" className="w-full py-3" loading={loading}>
                Update password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, type, value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
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
