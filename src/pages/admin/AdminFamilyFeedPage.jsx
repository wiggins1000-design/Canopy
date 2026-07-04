import { useState, useEffect } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'

const STATUS_LABEL = {
  success:               'Success',
  error:                 'Error',
  skipped_consent:       'Skipped — no consent',
  skipped_unrecognised:  'Skipped — unrecognised sender',
}

const STATUS_COLOUR = {
  success:              'bg-green-900/50 text-green-400',
  error:                'bg-red-900/50 text-red-400',
  skipped_consent:      'bg-amber-900/50 text-amber-400',
  skipped_unrecognised: 'bg-slate-700 text-slate-400',
}

const FILTERS = [
  { code: 'all',                  label: 'All' },
  { code: 'error',                label: 'Errors' },
  { code: 'success',               label: 'Success' },
  { code: 'skipped_consent',       label: 'No consent' },
  { code: 'skipped_unrecognised',  label: 'Unrecognised' },
]

export default function AdminFamilyFeedPage() {
  const [rows, setRows]         = useState([])
  const [stats, setStats]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter]     = useState('all')
  const [search, setSearch]     = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: logRows }, { data: statRow }] = await Promise.all([
      supabase.rpc('get_admin_email_processing_log', { p_limit: 200 }),
      supabase.rpc('get_admin_email_processing_stats'),
    ])
    setRows(logRows ?? [])
    setStats(statRow ?? null)
    setLoading(false)
  }

  const q = search.trim().toLowerCase()
  const visible = rows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false
    if (q) {
      return (r.subject ?? '').toLowerCase().includes(q) ||
        (r.from_email ?? '').toLowerCase().includes(q) ||
        (r.family_name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">FamilyFeed — Email Processing</h1>
          <p className="text-slate-400 text-sm mt-1">Recent inbound emails, feedback outcome, and diagnostics for failures</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by subject, email or family…"
          className="bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-canopy-green w-72 mt-1"
        />
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.code}
            onClick={() => setFilter(f.code)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              filter === f.code ? 'bg-canopy-green text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary stats (last 30 days) */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Processed (30d)" value={loading ? null : stats?.total_30d} />
        <StatCard label="Success (30d)"   value={loading ? null : stats?.success_30d} colour="green" />
        <StatCard label="Errors (30d)"    value={loading ? null : stats?.error_30d}   colour="red" />
        <StatCard label="Skipped (30d)"   value={loading ? null : stats?.skipped_30d} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-slate-500 text-sm">No matching emails processed yet.</p>
      ) : (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden divide-y divide-slate-700/50">
          {visible.map(row => (
            <LogRow
              key={row.id}
              row={row}
              isExpanded={expanded === row.id}
              onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LogRow({ row, isExpanded, onToggle }) {
  const canExpand = row.status === 'error'
  return (
    <div className={canExpand ? 'cursor-pointer' : ''} onClick={canExpand ? onToggle : undefined}>
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-700/30 transition-colors">
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${row.status === 'error' ? 'bg-red-500' : row.status === 'success' ? 'bg-green-500' : 'bg-slate-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm truncate">{row.subject || '(no subject)'}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOUR[row.status] ?? 'bg-slate-700 text-slate-400'}`}>
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-0.5 truncate">
            {row.family_name ?? 'Unknown family'} · {row.from_email}
          </p>
          {row.status === 'success' && (
            <p className="text-slate-400 text-xs mt-1">
              {row.events_created} created · {row.events_updated} updated · {row.events_skipped} skipped
              {row.docs_saved > 0 ? ` · ${row.docs_saved} attachment${row.docs_saved > 1 ? 's' : ''}` : ''}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-slate-500 text-xs whitespace-nowrap">
            {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
          </span>
          {canExpand && <div className="text-slate-500 text-xs mt-1">{isExpanded ? '▲' : '▼'}</div>}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-700 px-4 py-4 space-y-4 bg-slate-900/30" onClick={(e) => e.stopPropagation()}>
          {row.diagnosis ? (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Diagnosis</p>
              <p className="text-sm text-slate-200 leading-relaxed">{row.diagnosis}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No diagnosis available.</p>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Failure stage — {row.error_stage ?? 'unknown'}
            </p>
            <pre className="text-xs text-slate-400 bg-slate-900 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {row.error_message ?? '(no error message recorded)'}
            </pre>
          </div>

          <p className="text-xs text-slate-600">
            Failed at {format(new Date(row.created_at), 'd MMM yyyy HH:mm')}
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, colour }) {
  const colours = { green: 'text-green-400', red: 'text-red-400' }
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${colours[colour] ?? 'text-white'}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </p>
    </div>
  )
}
