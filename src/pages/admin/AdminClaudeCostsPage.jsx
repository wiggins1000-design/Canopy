import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const CATEGORY_LABEL = {
  term_dates:        'Term Dates',
  familyfeed:        'FamilyFeed',
  plan_review:       'Plan Review (parenting plan tool)',
  event_extraction:  'Event Extraction (photo/voice)',
  admin_tools:       'Admin Tools',
  other:             'Other',
}

const WINDOWS = [
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

function fmtUsd(n) {
  const v = Number(n ?? 0)
  return v < 0.01 && v > 0 ? `<$0.01` : `$${v.toFixed(2)}`
}

function fmtTokens(n) {
  const v = Number(n ?? 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

export default function AdminClaudeCostsPage() {
  const [days, setDays]       = useState(30)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [days])

  async function load() {
    setLoading(true)
    const { data: row } = await supabase.rpc('get_admin_claude_costs', { p_days: days })
    setData(row ?? null)
    setLoading(false)
  }

  const byCategory = data?.by_category ?? []

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Claude API Costs</h1>
          <p className="text-slate-400 text-sm mt-1">Spend broken down by feature — pulled from every Claude call Canopy makes, not the Anthropic Console total</p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOWS.map(w => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                days === w.days ? 'bg-canopy-green text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label={`Total spend (${days}d)`} value={fmtUsd(data?.total_cost_usd)} />
            <StatCard label={`Total calls (${days}d)`} value={data?.total_calls ?? 0} />
          </div>

          {byCategory.length === 0 ? (
            <p className="text-slate-500 text-sm">No Claude usage logged in this window yet.</p>
          ) : (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden divide-y divide-slate-700/50">
              {byCategory.map(c => (
                <div key={c.category} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {c.calls} call{c.calls !== 1 ? 's' : ''} · {fmtTokens(c.input_tokens)} in / {fmtTokens(c.output_tokens)} out
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-bold text-lg">{fmtUsd(c.cost_usd)}</p>
                    {data?.total_cost_usd > 0 && (
                      <p className="text-slate-500 text-xs">{Math.round((c.cost_usd / data.total_cost_usd) * 100)}% of total</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-1 text-white">{value}</p>
    </div>
  )
}
