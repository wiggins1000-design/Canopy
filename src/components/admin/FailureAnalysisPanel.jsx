import { useState } from 'react'
import { supabase } from '../../lib/supabase'

function isoDate(d) { return d.toISOString().split('T')[0] }

const PRESETS = [
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

// Shared "collate failures for a period and ask Claude to cluster them into root
// causes" panel — used by both /admin/term-dates and /admin/familyfeed. Produces
// plain text meant to be copied straight into a Claude Code session for the
// actual dev work, not an auto-patch.
export default function FailureAnalysisPanel({ type }) {
  const [from, setFrom]         = useState(isoDate(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo]             = useState(isoDate(new Date()))
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [copied, setCopied]     = useState(false)

  function applyPreset(days) {
    setFrom(isoDate(new Date(Date.now() - days * 86400000)))
    setTo(isoDate(new Date()))
  }

  async function analyse() {
    setLoading(true)
    setError(null)
    setResult(null)
    setCopied(false)
    const { data, error: fnErr } = await supabase.functions.invoke('analyze-admin-failures', {
      body: { type, from, to },
    })
    setLoading(false)
    if (fnErr) { setError(fnErr.message || 'Analysis failed'); return }
    setResult(data)
  }

  async function copy() {
    if (!result?.analysis) return
    await navigator.clipboard.writeText(result.analysis)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-white font-semibold text-sm">Failure analysis</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Collates failures for the selected period and asks Claude to cluster them into root causes —
          a backlog to paste into a dev session, not an automatic fix.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {PRESETS.map(p => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white" />
        </div>
        <button
          onClick={analyse}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-canopy-green text-white hover:bg-canopy-mid transition-colors disabled:opacity-50"
        >
          {loading ? 'Analysing…' : 'Analyse failures'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && result.total_count === 0 && (
        <p className="text-sm text-slate-500">No failures in this period.</p>
      )}

      {result && result.total_count > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">{result.total_count} failure{result.total_count > 1 ? 's' : ''} in this period</p>
            <button onClick={copy} className="text-xs font-medium text-canopy-light hover:underline">
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          </div>
          <pre className="text-xs text-slate-200 bg-slate-900 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {result.analysis}
          </pre>
        </div>
      )}
    </div>
  )
}
