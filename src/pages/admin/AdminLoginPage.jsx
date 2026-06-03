import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import Button from '../../components/ui/Button'
import PasswordField from '../../components/ui/PasswordField'

export default function AdminLoginPage() {
  const { session, signInWithEmail, signOut } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // If a session already exists when this page loads, check admin status
  useEffect(() => {
    if (!session) return
    supabase.rpc('is_admin').then(({ data }) => {
      if (data) {
        navigate('/admin/dashboard', { replace: true })
      } else {
        signOut()
        setError('This account does not have admin access.')
      }
    })
  }, [session])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signInWithEmail(email, password)
    if (error) { setError(error.message); setLoading(false) }
    // On success, session changes → useEffect above verifies admin status
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-slate-700 text-white text-2xl mb-4">
            🌿
          </div>
          <h1 className="text-2xl font-bold text-white">Canopy Admin</h1>
          <p className="text-slate-500 text-sm mt-1">Authorised access only</p>
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@mycanopymail.com"
                required
                autoComplete="username"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              required
              dark
            />

            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded-xl px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full py-3" loading={loading}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
