import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'

const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN ?? 'canopy.app'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState(null)
  const [families, setFamilies] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    loadFamilies()
  }, [])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => loadFamilies(search), 300)
    return () => clearTimeout(t)
  }, [search])

  async function loadStats() {
    const { data } = await supabase.rpc('get_admin_stats')
    if (data) setStats(data)
  }

  async function loadFamilies(q = '') {
    setLoading(true)
    const { data } = await supabase.rpc('get_admin_families', {
      p_search: q || null,
      p_limit: 50,
      p_offset: 0,
    })
    setFamilies(data ?? [])
    setLoading(false)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Platform overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total families"  value={stats?.total_families} />
        <StatCard label="Total members"   value={stats?.total_members} />
        <StatCard label="New this week"   value={stats?.new_this_week} highlight />
        <StatCard label="New this month"  value={stats?.new_this_month} />
      </div>

      {/* Families table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Families
            {!loading && <span className="text-slate-500 font-normal text-sm ml-2">({families.length})</span>}
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  {['Family', 'Members', 'Schedule', 'Posts', 'Events', 'Created'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : families.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      {search ? 'No families match that search' : 'No families yet'}
                    </td>
                  </tr>
                ) : families.map((f) => (
                  <tr key={f.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{f.name}</p>
                      <p className="text-slate-500 text-xs font-mono mt-0.5">
                        {f.email_key}@{EMAIL_DOMAIN}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{f.member_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        f.has_schedule
                          ? 'bg-green-900/50 text-green-400'
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {f.has_schedule ? 'Set' : 'Not set'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{f.post_count}</td>
                    <td className="px-4 py-3 text-slate-300">{f.event_count}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {format(new Date(f.created_at), 'd MMM yyyy')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 ${highlight ? 'bg-blue-600/10 border-blue-500/30' : 'bg-slate-800 border-slate-700'}`}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${highlight ? 'text-blue-400' : 'text-white'}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </p>
    </div>
  )
}
