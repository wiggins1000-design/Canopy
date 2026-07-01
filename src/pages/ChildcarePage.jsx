import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useLocale } from '../hooks/useLocale'
import { getBaselineOwner, formatDate } from '../lib/scheduleEngine'
import Button from '../components/ui/Button'

function formatHours(h) {
  const n = Number(h)
  if (!n) return '0h'
  const whole = Math.floor(n)
  const mins  = Math.round((n - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (whole === 0) return `${mins}m`
  return `${whole}h ${mins}m`
}

function getPeriodRange(period, customFrom, customTo) {
  const now  = new Date()
  const fd   = (d) => formatDate(d)
  const mon  = (d) => { const day = d.getDay(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 0 ? -6 : 1 - day)) }
  switch (period) {
    case 'this_week': {
      const s = mon(now)
      return { from: fd(s), to: fd(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)) }
    }
    case 'last_week': {
      const s = mon(now); s.setDate(s.getDate() - 7)
      return { from: fd(s), to: fd(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)) }
    }
    case 'this_month':
      return { from: fd(new Date(now.getFullYear(), now.getMonth(), 1)), to: fd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    case 'last_month':
      return { from: fd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fd(new Date(now.getFullYear(), now.getMonth(), 0)) }
    case 'custom':
      return { from: customFrom, to: customTo }
    default:
      return { from: '', to: '' }
  }
}

export default function ChildcarePage() {
  const navigate = useNavigate()
  const { family, member, members, isParent, parentA, parentB, schedule } = useFamily()
  const regionConfig = useLocale()

  const childcareMembers = family?.config?.childcare_members ?? []
  const isChildcare = childcareMembers.includes(member?.user_id)

  const paName = parentA?.display_name ?? 'Parent A'
  const pbName = parentB?.display_name ?? 'Parent B'
  const today  = formatDate(new Date())

  const [activeTab, setActiveTab] = useState(isChildcare ? 'log' : 'summary')
  const [logs,      setLogs]      = useState([])
  const [loading,   setLoading]   = useState(true)

  // Log form
  const [logDate,      setLogDate]      = useState(today)
  const [hours,        setHours]        = useState('')
  const [payingParent, setPayingParent] = useState(null)
  const [notes,        setNotes]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [deleting,     setDeleting]     = useState(null)

  // Summary
  const [period,     setPeriod]     = useState('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const loadLogs = useCallback(async () => {
    if (!family?.id) return []
    const { data } = await supabase
      .from('childcare_logs')
      .select('*')
      .eq('family_id', family.id)
      .order('log_date', { ascending: false })
    const fresh = data ?? []
    setLogs(fresh)
    setLoading(false)
    return fresh
  }, [family?.id])

  useEffect(() => {
    loadLogs().then((fresh) => {
      populateForm(today, fresh)
    })
  }, [loadLogs]) // eslint-disable-line react-hooks/exhaustive-deps

  function populateForm(date, currentLogs) {
    const myLogs = currentLogs.filter((l) => l.logged_by === member?.user_id)
    const existing = myLogs.find((l) => l.log_date === date)
    if (existing) {
      setHours(String(existing.hours_decimal))
      setPayingParent(existing.paying_parent)
      setNotes(existing.notes ?? '')
    } else {
      setHours('')
      setPayingParent(schedule ? getBaselineOwner(schedule, date) : null)
      setNotes('')
    }
    setSaved(false)
  }

  function handleDateChange(newDate) {
    setLogDate(newDate)
    populateForm(newDate, logs)
  }

  async function saveLog() {
    const parsedHours = parseFloat(hours)
    if (!parsedHours || parsedHours <= 0 || parsedHours > 24 || !payingParent) return
    setSaving(true)
    const { error } = await supabase.rpc('upsert_childcare_log', {
      p_date:          logDate,
      p_hours:         parsedHours,
      p_paying_parent: payingParent,
      p_notes:         notes.trim() || null,
    })
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      const fresh = await loadLogs()
      populateForm(logDate, fresh)
    }
    setSaving(false)
  }

  async function deleteLog(logId) {
    setDeleting(logId)
    await supabase.rpc('delete_childcare_log', { p_log_id: logId })
    const fresh = await loadLogs()
    populateForm(logDate, fresh)
    setDeleting(null)
  }

  const myLogs = logs.filter((l) => l.logged_by === member?.user_id)
  const isEditing = myLogs.some((l) => l.log_date === logDate)

  const { from: periodFrom, to: periodTo } = getPeriodRange(period, customFrom, customTo)

  const summaryLogs = (() => {
    if (!periodFrom || !periodTo) return []
    const filtered = logs.filter((l) => l.log_date >= periodFrom && l.log_date <= periodTo)
    return isParent ? filtered : filtered.filter((l) => l.logged_by === member?.user_id)
  })()

  const rates = family?.config?.childcare_rates ?? {}

  // Per-carer breakdown: [ { carerId, carerName, rate, paHours, pbHours, totalHours, paWages, pbWages, totalWages, hasRate } ]
  const carerIds = [...new Set(summaryLogs.map((l) => l.logged_by))]
  const carerBreakdown = carerIds.map((carerId) => {
    const carerLogs = summaryLogs.filter((l) => l.logged_by === carerId)
    const paHours   = carerLogs.filter((l) => l.paying_parent === 'parent_a').reduce((s, l) => s + Number(l.hours_decimal), 0)
    const pbHours   = carerLogs.filter((l) => l.paying_parent === 'parent_b').reduce((s, l) => s + Number(l.hours_decimal), 0)
    const totalHrs  = paHours + pbHours
    const ratePence = rates[carerId] ?? 0
    const hasRate   = ratePence > 0
    return {
      carerId,
      carerName:  members.find((m) => m.user_id === carerId)?.display_name ?? 'Unknown',
      rate:        ratePence,
      paHours, pbHours,
      totalHours: totalHrs,
      paWages:    hasRate ? (paHours  * ratePence / 100) : null,
      pbWages:    hasRate ? (pbHours  * ratePence / 100) : null,
      totalWages: hasRate ? (totalHrs * ratePence / 100) : null,
      hasRate,
    }
  })

  const grandTotalHours = carerBreakdown.reduce((s, c) => s + c.totalHours, 0)
  const grandTotalWages = carerBreakdown.every((c) => c.hasRate)
    ? carerBreakdown.reduce((s, c) => s + (c.totalWages ?? 0), 0)
    : null

  // Overall per-parent totals (for the top cards)
  const paHours    = summaryLogs.filter((l) => l.paying_parent === 'parent_a').reduce((s, l) => s + Number(l.hours_decimal), 0)
  const pbHours    = summaryLogs.filter((l) => l.paying_parent === 'parent_b').reduce((s, l) => s + Number(l.hours_decimal), 0)
  const paWages    = carerBreakdown.every((c) => c.hasRate) ? carerBreakdown.reduce((s, c) => s + (c.paWages ?? 0), 0) : null
  const pbWages    = carerBreakdown.every((c) => c.hasRate) ? carerBreakdown.reduce((s, c) => s + (c.pbWages ?? 0), 0) : null

  function fmt(majorUnits) {
    return new Intl.NumberFormat(regionConfig.locale, {
      style: 'currency',
      currency: regionConfig.currency.code,
    }).format(majorUnits)
  }

  function memberName(userId) {
    return members.find((m) => m.user_id === userId)?.display_name ?? 'Unknown'
  }

  function formatLogDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(regionConfig.locale, { weekday: 'short', day: 'numeric', month: 'short' })
  }

  if (!isChildcare && !isParent) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-400">
        You don't have access to this page.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const suggested = schedule ? getBaselineOwner(schedule, logDate) : null

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">Childcare</h1>
      </div>

      {/* Tabs — only shown to childcare members */}
      {isChildcare && (
        <div className="flex gap-1.5">
          {[{ id: 'log', label: 'Log hours' }, { id: 'summary', label: 'Summary' }].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === t.id ? 'bg-canopy-mid text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Log form ─────────────────────────────────────────── */}
      {activeTab === 'log' && isChildcare && (
        <div className="space-y-3">

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date</label>
            <input
              type="date"
              value={logDate}
              max={today}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
            />
          </div>

          {/* Hours */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Hours worked</label>
            <input
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setSaved(false) }}
              placeholder="e.g. 8 or 7.5"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
            />
          </div>

          {/* Paying parent */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Paying parent</label>
              {suggested && payingParent !== suggested && (
                <button
                  onClick={() => setPayingParent(suggested)}
                  className="text-xs text-canopy-mid hover:underline"
                >
                  Reset to schedule
                </button>
              )}
            </div>
            {suggested && (
              <p className="text-xs text-gray-400 mb-2">
                Schedule suggests: <span className="font-semibold">{suggested === 'parent_a' ? paName : pbName}</span>
                {payingParent && payingParent !== suggested ? ' (overridden)' : ''}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setPayingParent('parent_a'); setSaved(false) }}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors border-2 ${
                  payingParent === 'parent_a' ? 'bg-canopy-mid text-white border-canopy-mid' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {paName}
              </button>
              <button
                onClick={() => { setPayingParent('parent_b'); setSaved(false) }}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors border-2 ${
                  payingParent === 'parent_b' ? 'bg-canopy-mid text-white border-canopy-mid' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {pbName}
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              Notes <span className="font-normal text-gray-400 normal-case">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setSaved(false) }}
              placeholder="e.g. School pick-up, after-school club"
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
            />
          </div>

          <Button
            className="w-full py-3"
            loading={saving}
            disabled={!hours || parseFloat(hours) <= 0 || !payingParent}
            onClick={saveLog}
          >
            {saved ? '✓ Saved' : isEditing ? 'Update' : 'Save'}
          </Button>

          {/* Recent entries */}
          {myLogs.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent entries</p>
              {myLogs.slice(0, 15).map((log) => (
                <div
                  key={log.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    log.log_date === logDate ? 'bg-canopy-frost border-canopy-mist' : 'bg-gray-50 border-gray-100'
                  }`}
                >
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => handleDateChange(log.log_date)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{formatLogDate(log.log_date)}</p>
                      <span className="text-sm font-bold text-canopy-mid">{formatHours(log.hours_decimal)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {log.paying_parent === 'parent_a' ? paName : pbName} paying
                      {log.notes ? ` · ${log.notes}` : ''}
                    </p>
                  </button>
                  <button
                    onClick={() => deleteLog(log.id)}
                    disabled={deleting === log.id}
                    className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-50 py-1"
                  >
                    {deleting === log.id ? '…' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Summary ──────────────────────────────────────────── */}
      {(activeTab === 'summary' || !isChildcare) && (
        <div className="space-y-4">

          {/* Period selector */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {[
              { id: 'this_week',  label: 'This week'  },
              { id: 'last_week',  label: 'Last week'  },
              { id: 'this_month', label: 'This month' },
              { id: 'last_month', label: 'Last month' },
              { id: 'custom',     label: 'Custom'     },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
                  period === p.id ? 'bg-canopy-mid text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
                />
              </div>
            </div>
          )}

          {summaryLogs.length > 0 ? (
            <>
              {/* Per-parent totals */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-canopy-frost border border-canopy-mist rounded-2xl px-4 py-3">
                  <p className="text-xs font-semibold text-canopy-green uppercase tracking-wide truncate">{paName}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatHours(paHours)}</p>
                  {paWages !== null && <p className="text-sm font-semibold text-canopy-mid mt-0.5">{fmt(paWages)}</p>}
                </div>
                <div className="bg-canopy-frost border border-canopy-mist rounded-2xl px-4 py-3">
                  <p className="text-xs font-semibold text-canopy-green uppercase tracking-wide truncate">{pbName}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatHours(pbHours)}</p>
                  {pbWages !== null && <p className="text-sm font-semibold text-canopy-mid mt-0.5">{fmt(pbWages)}</p>}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Total</p>
                <div className="text-right">
                  <p className="text-lg font-bold text-canopy-mid">{formatHours(grandTotalHours)}</p>
                  {grandTotalWages !== null && <p className="text-sm font-semibold text-gray-600">{fmt(grandTotalWages)}</p>}
                </div>
              </div>

              {/* Per-carer breakdown (shown when multiple carers or when a rate is set) */}
              {(carerBreakdown.length > 1 || carerBreakdown.some((c) => c.hasRate)) && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By carer</p>
                  {carerBreakdown.map((c) => (
                    <div key={c.carerId} className="bg-white border border-gray-200 rounded-2xl px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900">{c.carerName}</p>
                        {c.hasRate
                          ? <span className="text-xs text-gray-500">{fmt(c.rate / 100)}/hr</span>
                          : <span className="text-xs text-amber-600">No rate set</span>
                        }
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-gray-50 rounded-xl px-3 py-2">
                          <p className="font-semibold text-gray-500 truncate">{paName}</p>
                          <p className="font-bold text-gray-800 mt-0.5">{formatHours(c.paHours)}</p>
                          {c.paWages !== null && <p className="text-canopy-mid font-semibold">{fmt(c.paWages)}</p>}
                        </div>
                        <div className="bg-gray-50 rounded-xl px-3 py-2">
                          <p className="font-semibold text-gray-500 truncate">{pbName}</p>
                          <p className="font-bold text-gray-800 mt-0.5">{formatHours(c.pbHours)}</p>
                          {c.pbWages !== null && <p className="text-canopy-mid font-semibold">{fmt(c.pbWages)}</p>}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs pt-1 border-t border-gray-100">
                        <span className="text-gray-500">Total</span>
                        <span className="font-bold text-gray-800">
                          {formatHours(c.totalHours)}{c.totalWages !== null ? ` = ${fmt(c.totalWages)}` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Log entries */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Entries</p>
                {summaryLogs.map((log) => {
                  const ratePence = rates[log.logged_by] ?? 0
                  const wages = ratePence > 0 ? (Number(log.hours_decimal) * ratePence / 100) : null
                  return (
                    <div key={log.id} className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900">{formatLogDate(log.log_date)}</p>
                        <div className="text-right">
                          <span className="text-sm font-bold text-canopy-mid">{formatHours(log.hours_decimal)}</span>
                          {wages !== null && <p className="text-xs text-gray-600 font-semibold">{fmt(wages)}</p>}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {isParent && <>{memberName(log.logged_by)} · </>}
                        {log.paying_parent === 'parent_a' ? paName : pbName} paying
                        {log.notes ? ` · ${log.notes}` : ''}
                      </p>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-sm text-gray-400">
              No childcare hours logged for this period.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
