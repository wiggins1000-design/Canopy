import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, needsTwoFa } = useAuth()

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (needsTwoFa) return <Navigate to="/2fa" replace />

  return children
}
