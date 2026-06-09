import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'

const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN ?? 'canopy.app'

const ROLE_BADGE = {
  parent_a:    'bg-blue-900/50 text-blue-300',
  parent_b:    'bg-orange-900/50 text-orange-300',
  third_party: 'bg-slate-700 text-slate-300',
}

export default function AdminFamilyPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    loadFamily()
  }, [id])

  async function loadFamily() {
    setLoading(true)
    const { data: result, error: err } = await supabase.rpc('get_admin_family_detail', { p_family_id: id })
    if (err) { setError(err.message); setLoading(false); return }
    setData(result)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1">
          ← Back
        </button>
        <p className="text-red-400">{error ?? 'Family not found'}</p>
      </div>
    )
  }

  const { family, members, schedule, recent_posts, recent_events, stats } = data

  return (
    <div className="space-y-8">
      {/* Back + header */}
      <div>
        <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 mb-3">
          ← All families
        </button>
        <h1 className="text-2xl font-bold text-white">{family.name}</h1>
        <p className="text-slate-400 text-sm font-mono mt-0.5">
          {family.email_key}@{EMAIL_DOMAIN}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          Created {format(new Date(family.created_at), 'd MMM yyyy')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Posts"     value={stats?.post_count} />
        <StatCard label="Events"    value={stats?.event_count} />
        <StatCard label="Changes"   value={stats?.change_count} />
        <StatCard label="Holidays"  value={stats?.holiday_count} highlight />
      </div>

      {/* Members */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Members ({members?.length ?? 0})</h2>
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {['Name', 'Email', 'Role', 'Push', 'Joined'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.user_id} className="border-b border-slate-700/50">
                  <td className="px-4 py-3 text-white font-medium">{m.display_name}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{m.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role] ?? 'bg-slate-700 text-slate-400'}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${m.push_token ? 'text-green-400' : 'text-slate-600'}`}>
                      {m.push_token ? '✓' : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {format(new Date(m.created_at), 'd MMM yyyy')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Schedule */}
      {schedule && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Schedule</h2>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Pattern</p>
                <p className="text-white">{schedule.pattern_type}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Start date</p>
                <p className="text-white">{schedule.start_date}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent posts */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Recent posts</h2>
          <div className="space-y-2">
            {(recent_posts ?? []).length === 0 ? (
              <p className="text-slate-500 text-sm">No posts yet</p>
            ) : (recent_posts ?? []).map((p) => (
              <div key={p.id} className="bg-slate-800 rounded-xl border border-slate-700 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  {p.tag && <span className="text-xs bg-slate-700 text-slate-300 rounded-full px-2 py-0.5">{p.tag}</span>}
                  <span className="text-xs text-slate-500">{format(new Date(p.created_at), 'd MMM')}</span>
                </div>
                <p className="text-sm text-slate-300 line-clamp-2">{p.content}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Recent events */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Recent events</h2>
          <div className="space-y-2">
            {(recent_events ?? []).length === 0 ? (
              <p className="text-slate-500 text-sm">No events yet</p>
            ) : (recent_events ?? []).map((e) => (
              <div key={e.id} className="bg-slate-800 rounded-xl border border-slate-700 px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white font-medium">{e.title}</p>
                  <p className="text-xs text-slate-500">{e.event_date} · {e.source}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
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
