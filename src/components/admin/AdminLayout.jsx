import { useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function AdminLayout() {
  const { signOut } = useAuth()

  useEffect(() => {
    const prev = document.title
    document.title = 'Canopy Admin Dashboard'
    return () => { document.title = prev }
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-canopy-mid flex items-center justify-center text-white text-xs font-bold">C</div>
          <span className="text-white font-semibold text-sm">Canopy</span>
          <span className="text-slate-500 text-xs border border-slate-600 rounded px-1.5 py-0.5">Admin</span>
        </div>
        <nav className="flex items-center gap-6">
          <NavLink
            to="/admin/dashboard"
            className={({ isActive }) =>
              `text-xs font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/admin/term-dates"
            className={({ isActive }) =>
              `text-xs font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
            }
          >
            Term Dates
          </NavLink>
          <NavLink
            to="/admin/familyfeed"
            className={({ isActive }) =>
              `text-xs font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
            }
          >
            FamilyFeed
          </NavLink>
          <NavLink
            to="/admin/broadcast"
            className={({ isActive }) =>
              `text-xs font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
            }
          >
            Broadcast
          </NavLink>
          <NavLink
            to="/admin/claude-costs"
            className={({ isActive }) =>
              `text-xs font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
            }
          >
            Claude Costs
          </NavLink>
          <button
            onClick={signOut}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </nav>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
