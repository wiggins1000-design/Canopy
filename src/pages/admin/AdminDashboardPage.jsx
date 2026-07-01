import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const LOCALES = [
  { code: null,    label: 'All',       flag: '' },
  { code: 'en-GB', label: 'UK',        flag: '🇬🇧' },
  { code: 'en-AU', label: 'Australia', flag: '🇦🇺' },
  { code: 'en-IE', label: 'Ireland',   flag: '🇮🇪' },
  { code: 'en-US', label: 'US',        flag: '🇺🇸' },
]

const LOCALE_FLAG = { 'en-GB': '🇬🇧', 'en-AU': '🇦🇺', 'en-IE': '🇮🇪', 'en-US': '🇺🇸' }

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [families, setFamilies] = useState([])
  const [search, setSearch] = useState('')
  const [locale, setLocale] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  useEffect(() => {
    const t = setTimeout(() => loadFamilies(search, locale), 300)
    return () => clearTimeout(t)
  }, [search, locale])

  async function loadStats() {
    const { data } = await supabase.rpc('get_admin_stats')
    if (data) setStats(data)
  }

  async function loadFamilies(q = '', loc = null) {
    setLoading(true)
    const { data } = await supabase.rpc('get_admin_families', {
      p_search: q || null,
      p_limit:  50,
      p_offset: 0,
      p_locale: loc,
    })
    setFamilies(data ?? [])
    setLoading(false)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Canopy Admin Dashboard</h1>
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
        <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-white">
            Families
            {!loading && <span className="text-slate-500 font-normal text-sm ml-2">({families.length})</span>}
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-canopy-green w-56"
          />
        </div>

        {/* Locale filter */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {LOCALES.map(l => (
            <button
              key={l.code ?? 'all'}
              onClick={() => setLocale(l.code)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                locale === l.code
                  ? 'bg-canopy-green text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {l.flag && <span>{l.flag}</span>}
              <span>{l.label}</span>
            </button>
          ))}
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  {['Family', 'Region', 'Members', 'Schedule', 'Posts', 'Events', 'Created'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : families.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {search || locale ? 'No families match that filter' : 'No families yet'}
                    </td>
                  </tr>
                ) : families.map((f) => (
                  <tr key={f.id} onClick={() => navigate(`/admin/family/${f.id}`)} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{f.parent_names ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-base" title={f.locale ?? 'en-GB'}>
                        {LOCALE_FLAG[f.locale ?? 'en-GB'] ?? '🌐'}
                      </span>
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
    <div className={`rounded-2xl border px-5 py-4 ${highlight ? 'bg-canopy-mid/10 border-canopy-green/30' : 'bg-slate-800 border-slate-700'}`}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${highlight ? 'text-canopy-light' : 'text-white'}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </p>
    </div>
  )
}
