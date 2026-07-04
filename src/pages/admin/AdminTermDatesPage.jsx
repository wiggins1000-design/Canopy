import { useState, useEffect, useMemo } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { getCalendarMonthDays, formatDate } from '../../lib/scheduleEngine'
import { buildTermDaysMap } from '../../lib/termDatesUtils'
import CalendarGrid from '../../components/calendar/CalendarGrid'
import FailureAnalysisPanel from '../../components/admin/FailureAnalysisPanel'

const LOCALES = [
  { code: 'all',   label: 'All',       flag: '' },
  { code: 'en-GB', label: 'UK',        flag: '🇬🇧' },
  { code: 'en-AU', label: 'Australia', flag: '🇦🇺' },
  { code: 'en-IE', label: 'Ireland',   flag: '🇮🇪' },
  { code: 'en-US', label: 'US',        flag: '🇺🇸' },
]

export default function AdminTermDatesPage() {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [failedOpen, setFailedOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [locale, setLocale] = useState('all')
  const [previewSchool, setPreviewSchool] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.rpc('get_admin_school_calendars')
    setSchools(data ?? [])
    setLoading(false)
  }

  const q = filter.trim().toLowerCase()
  const visible = schools.filter(s => {
    if (locale !== 'all' && (s.locale ?? 'en-GB') !== locale) return false
    if (q) return (s.school_name ?? '').toLowerCase().includes(q) || (s.homepage_url ?? '').toLowerCase().includes(q)
    return true
  })

  const failed  = visible.filter(s => s.scrape_error)
  const ok      = visible.filter(s => !s.scrape_error && s.last_fetched_at)
  const pending = visible.filter(s => !s.scrape_error && !s.last_fetched_at)

  const countsByLocale = LOCALES.slice(1).reduce((acc, l) => {
    acc[l.code] = schools.filter(s => (s.locale ?? 'en-GB') === l.code).length
    return acc
  }, {})

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

      {/* Country filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {LOCALES.map(l => (
          <button
            key={l.code}
            onClick={() => setLocale(l.code)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              locale === l.code
                ? 'bg-canopy-green text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {l.flag && <span>{l.flag}</span>}
            <span>{l.label}</span>
            {l.code !== 'all' && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${locale === l.code ? 'bg-white/20' : 'bg-slate-600'}`}>
                {countsByLocale[l.code] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label={q || locale !== 'all' ? 'Matching' : 'Total schools'} value={loading ? null : visible.length} />
        <StatCard label="Synced OK"     value={loading ? null : ok.length}      colour="green" />
        <StatCard label="Failed"        value={loading ? null : failed.length}   colour="red" />
      </div>

      <FailureAnalysisPanel type="term_dates" />

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
                    {['School', 'Homepage', 'Term dates URL', 'Dates', 'Last synced', ''].map(h => (
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
                      <td className="px-4 py-3">
                        {school.term_dates_count > 0 && (
                          <button
                            onClick={() => setPreviewSchool(school)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-canopy-green hover:text-white transition-colors whitespace-nowrap"
                          >
                            View in calendar
                          </button>
                        )}
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

      {previewSchool && (
        <SchoolCalendarModal school={previewSchool} onClose={() => setPreviewSchool(null)} />
      )}
    </div>
  )
}

// Renders a school's cached term_dates on a plain month calendar — fetched fresh from
// school_calendars via an admin-only RPC, purely client-side. Never reads or writes
// family_events, so this can't affect any real family's calendar.
function SchoolCalendarModal({ school, onClose }) {
  const [termDates, setTermDates] = useState(null)
  const [error, setError] = useState(null)
  const [viewDate, setViewDate] = useState(new Date())

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_admin_school_term_dates', { p_school_id: school.id }).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); return }
      const dates = data ?? []
      setTermDates(dates)
      // Jump straight to the month of the earliest upcoming date (or the earliest date
      // at all, if every date is in the past) so the admin isn't stuck on an empty month.
      const today = formatDate(new Date())
      const sorted = [...dates].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      const target = sorted.find(d => d.date >= today) ?? sorted[0]
      if (target?.date) setViewDate(new Date(`${target.date}T00:00:00`))
    })
    return () => { cancelled = true }
  }, [school.id])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  // Always pad to 6 rows (42 cells) — getCalendarMonthDays returns 5 rows (35) for months
  // that fit, which otherwise makes the modal resize between months.
  const calendarDays = useMemo(() => {
    const days = getCalendarMonthDays(year, month).map(({ date, current }) => ({ date, dateStr: formatDate(date), current }))
    while (days.length < 42) {
      const prev = days[days.length - 1].date
      const next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)
      days.push({ date: next, dateStr: formatDate(next), current: false })
    }
    return days
  }, [year, month])

  const termDaysMap = useMemo(() => {
    if (!termDates) return new Map()
    const rows = termDates.map(d => ({
      event_date:     d.date,
      end_date:       d.end_date ?? null,
      title:          d.title,
      source_subject: school.school_name ?? 'School',
    }))
    return buildTermDaysMap(rows)
  }, [termDates, school.school_name])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="text-lg font-bold text-white">{school.school_name ?? 'School'}</h2>
            <p className="text-slate-500 text-xs mt-0.5">Preview only — not linked to any family calendar</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none px-1">×</button>
        </div>

        <div className="p-5">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !termDates ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setViewDate(new Date(year, month - 1, 1))}
                  className="w-8 h-8 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center"
                >‹</button>
                <span className="text-sm font-semibold text-white">
                  {viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  onClick={() => setViewDate(new Date(year, month + 1, 1))}
                  className="w-8 h-8 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center"
                >›</button>
              </div>

              <div className="bg-white rounded-2xl p-3">
                <CalendarGrid calendarDays={calendarDays} termDays={termDaysMap} onSelectDay={() => {}} />
              </div>

              <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-400" /> Holiday</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-200" /> INSET / closure day</span>
                <span className="ml-auto text-slate-500">{termDates.length} date{termDates.length === 1 ? '' : 's'} in KB</span>
              </div>
            </>
          )}
        </div>
      </div>
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
