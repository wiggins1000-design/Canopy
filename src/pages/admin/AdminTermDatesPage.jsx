import { useState, useEffect } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'

export default function AdminTermDatesPage() {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [failedOpen, setFailedOpen] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.rpc('get_admin_school_calendars')
    setSchools(data ?? [])
    setLoading(false)
  }

  const q = filter.trim().toLowerCase()
  const visible = q
    ? schools.filter(s =>
        (s.school_name ?? '').toLowerCase().includes(q) ||
        (s.homepage_url ?? '').toLowerCase().includes(q),
      )
    : schools

  const failed  = visible.filter(s => s.scrape_error)
  const ok      = visible.filter(s => !s.scrape_error && s.last_fetched_at)
  const pending = visible.filter(s => !s.scrape_error && !s.last_fetched_at)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Term Dates — School KB</h1>
          <p className="text-slate-400 text-sm mt-1">Scrape status for every school in the knowledge base</p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or URL…"
          className="bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-canopy-green w-64 mt-1"
        />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label={q ? 'Matching' : 'Total schools'} value={loading ? null : visible.length} />
        <StatCard label="Synced OK"     value={loading ? null : ok.length}      colour="green" />
        <StatCard label="Failed"        value={loading ? null : failed.length}   colour="red" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : schools.length === 0 ? (
        <p className="text-slate-500 text-sm">No schools in the knowledge base yet.</p>
      ) : (
        <div className="space-y-3">
          {/* Failed schools — collapsed by default */}
          {failed.length > 0 && (
            <div className="rounded-2xl border border-red-900/60 overflow-hidden">
              <button
                onClick={() => setFailedOpen(o => !o)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700/60 transition-colors text-left"
              >
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="text-white font-medium text-sm flex-1">
                  Failed
                  <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-900/50 text-red-400">
                    {failed.length}
                  </span>
                </span>
                <span className="text-slate-500 text-xs">{failedOpen ? '▲' : '▼'}</span>
              </button>
              {failedOpen && (
                <div className="border-t border-red-900/40 space-y-px bg-slate-900/30">
                  {failed.map(school => (
                    <FailedRow
                      key={school.id}
                      school={school}
                      isExpanded={expanded === school.id}
                      onToggle={() => setExpanded(expanded === school.id ? null : school.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OK schools */}
          {ok.length > 0 && (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    {['School', 'Homepage', 'Term dates URL', 'Dates', 'Last synced'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ok.map(school => (
                    <tr key={school.id} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-4 py-3 text-white font-medium">
                        {school.school_name ?? <span className="text-slate-500 italic">Unknown</span>}
                      </td>
                      <td className="px-4 py-3">
                        <a href={school.homepage_url} target="_blank" rel="noreferrer"
                          className="text-canopy-light hover:underline text-xs truncate block max-w-xs">
                          {school.homepage_url}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        {school.term_dates_url ? (
                          <a href={school.term_dates_url} target="_blank" rel="noreferrer"
                            className="text-slate-400 hover:text-white text-xs truncate block max-w-xs">
                            {school.term_dates_url}
                          </a>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-300 tabular-nums">{school.term_dates_count}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {school.last_fetched_at
                          ? formatDistanceToNow(new Date(school.last_fetched_at), { addSuffix: true })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending (in school_calendars but never fetched) */}
          {pending.map(school => (
            <div key={school.id} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
              <span className="text-slate-400 text-sm">{school.homepage_url}</span>
              <span className="text-xs text-slate-600 ml-auto">Never synced</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FailedRow({ school, isExpanded, onToggle }) {
  const errorType = school.scrape_error?.error_type ?? 'unknown'
  const errorTypeLabel = {
    homepage_fetch_failed: 'Homepage unreachable',
    discovery_failed:      'Term dates URL not found',
    page_fetch_failed:     'Term dates page unreachable',
    extraction_failed:     'Dates could not be extracted',
  }[errorType] ?? errorType

  return (
    <div className="bg-slate-800 border-b border-red-900/20 overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/30 transition-colors"
        onClick={onToggle}
      >
        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm">
              {school.school_name ?? school.homepage_url}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-900/50 text-red-400">
              {errorTypeLabel}
            </span>
            {school.scrape_error_at && (
              <span className="text-xs text-slate-500">
                {formatDistanceToNow(new Date(school.scrape_error_at), { addSuffix: true })}
              </span>
            )}
          </div>
          {school.school_name && (
            <a href={school.homepage_url} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-slate-500 hover:text-slate-300 text-xs mt-0.5 block truncate">
              {school.homepage_url}
            </a>
          )}
        </div>
        <span className="text-slate-500 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-slate-700 px-4 py-4 space-y-4">

          {/* Claude's diagnosis */}
          {school.scrape_diagnosis ? (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Diagnosis</p>
              <p className="text-sm text-slate-200 leading-relaxed">{school.scrape_diagnosis}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No diagnosis available — will be generated on next failed sync.</p>
          )}

          {/* Raw diagnostic data */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Raw diagnostic</p>
            <pre className="text-xs text-slate-400 bg-slate-900 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(school.scrape_error, null, 2)}
            </pre>
          </div>

          {/* Term dates URL attempted */}
          {school.scrape_error?.term_dates_url && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">URL attempted</p>
              <a href={school.scrape_error.term_dates_url} target="_blank" rel="noreferrer"
                className="text-canopy-light hover:underline text-sm break-all">
                {school.scrape_error.term_dates_url}
              </a>
            </div>
          )}

          {/* Links found (for discovery failures) */}
          {school.scrape_error?.links_found?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Links found on homepage ({school.scrape_error.links_found.length})
              </p>
              <ul className="space-y-0.5">
                {school.scrape_error.links_found.map((link, i) => (
                  <li key={i}>
                    <a href={link} target="_blank" rel="noreferrer"
                      className="text-xs text-slate-400 hover:text-white break-all">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Content preview (for extraction failures) */}
          {school.scrape_error?.content_preview && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Page content (first 600 chars)</p>
              <pre className="text-xs text-slate-400 bg-slate-900 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
                {school.scrape_error.content_preview}
              </pre>
            </div>
          )}

          {/* Failed at timestamp */}
          {school.scrape_error_at && (
            <p className="text-xs text-slate-600">
              Failed at {format(new Date(school.scrape_error_at), 'd MMM yyyy HH:mm')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, colour }) {
  const colours = {
    green: 'text-green-400',
    red:   'text-red-400',
  }
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${colours[colour] ?? 'text-white'}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </p>
    </div>
  )
}
