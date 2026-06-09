import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

export default function AdminRoute({ children }) {
  const { session } = useAuth()
  const [status, setStatus] = useState('loading') // 'loading' | 'admin' | 'denied'

  useEffect(() => {
    if (session === undefined) return
    if (!session) { setStatus('denied'); return }
    supabase.rpc('is_admin').then(({ data }) => {
      setStatus(data ? 'admin' : 'denied')
    })
  }, [session])

  if (status === 'loading' || session === undefined) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'denied') return <Navigate to="/admin/login" replace />

  return children
}
