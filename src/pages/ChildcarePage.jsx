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
  let whole   = Math.floor(n)
  let mins    = Math.round((n - whole) * 60)
  if (mins === 60) { whole += 1; mins = 0 } // rounding can carry a full minute into the next hour
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

  const [activeTab,        setActiveTab]        = useState(isChildcare ? 'log' : 'summary')
  const [logs,             setLogs]             = useState([])
  const [bills,            setBills]            = useState([])
  const [billsHasMore,     setBillsHasMore]     = useState(false)
  const [billsLoadingMore, setBillsLoadingMore] = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [parentFilter,     setParentFilter]     = useState(null) // null | 'parent_a' | 'parent_b' — tap a totals card to filter Entries, tap again to clear

  // Log form
  const [logDate,      setLogDate]      = useState(today)
  const [hours,        setHours]        = useState('')
  const [payingParent, setPayingParent] = useState(null)
  const [notes,        setNotes]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [deleting,     setDeleting]     = useState(null)
  const [logError,     setLogError]     = useState(null)

  // Bills
  const [billCreating, setBillCreating] = useState(null)
  const [billUpdating, setBillUpdating] = useState(null)
  const [billError,    setBillError]    = useState(null)

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

  const BILLS_PAGE_SIZE = 8

  const loadBills = useCallback(async () => {
    if (!family?.id) return []
    const { data } = await supabase
      .from('childcare_bills')
      .select('*')
      .eq('family_id', family.id)
      // Tiebreaker matters: the per-parent bill split (migration 078) created
      // pairs of invoices sharing the exact same created_at, and Postgres
      // doesn't guarantee stable order for ties -- without a deterministic
      // secondary key, an unrelated UPDATE (e.g. toggling paid status) could
      // shuffle which one comes first on the next fetch.
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(0, BILLS_PAGE_SIZE - 1)
    const fresh = data ?? []
    setBills(fresh)
    setBillsHasMore(fresh.length === BILLS_PAGE_SIZE)
    return fresh
  }, [family?.id])

  async function loadMoreBills() {
    if (!family?.id) return
    setBillsLoadingMore(true)
    const { data } = await supabase
      .from('childcare_bills')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(bills.length, bills.length + BILLS_PAGE_SIZE - 1)
    const fresh = data ?? []
    setBills((prev) => [...prev, ...fresh])
    setBillsHasMore(fresh.length === BILLS_PAGE_SIZE)
    setBillsLoadingMore(false)
  }

  useEffect(() => {
    loadLogs().then((fresh) => {
      populateForm(today, fresh)
    })
    loadBills()
  }, [loadLogs, loadBills]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setLogError(null)
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
    } else {
      setLogError(error.message)
    }
    setSaving(false)
  }

  async function deleteLog(logId) {
    setDeleting(logId)
    setLogError(null)
    const { error } = await supabase.rpc('delete_childcare_log', { p_log_id: logId })
    if (error) setLogError(error.message)
    const fresh = await loadLogs()
    populateForm(logDate, fresh)
    setDeleting(null)
  }

  async function createBill(carerId, payerRole = null) {
    setBillCreating(carerId)
    setBillError(null)
    const { error } = await supabase.rpc('create_childcare_bill', {
      p_carer_id:   carerId,
      p_from:       periodFrom,
      p_to:         periodTo,
      p_payer_role: payerRole,
    })
    if (error) setBillError(error.message)
    await Promise.all([loadLogs(), loadBills()])
    setBillCreating(null)
  }

  async function toggleBillPaid(bill) {
    setBillUpdating(bill.id)
    setBillError(null)
    const { error } = await supabase.rpc('set_childcare_bill_paid', {
      p_bill_id: bill.id,
      p_paid:    bill.status !== 'paid',
    })
    if (error) setBillError(error.message)
    await loadBills()
    setBillUpdating(null)
  }

  async function removeBill(billId) {
    setBillUpdating(billId)
    setBillError(null)
    const { error } = await supabase.rpc('delete_childcare_bill', { p_bill_id: billId })
    if (error) setBillError(error.message)
    await Promise.all([loadLogs(), loadBills()])
    setBillUpdating(null)
  }

  const myLogs = logs.filter((l) => l.logged_by === member?.user_id)
  const isEditing = myLogs.some((l) => l.log_date === logDate)

  const { from: periodFrom, to: periodTo } = getPeriodRange(period, customFrom, customTo)

  const summaryLogs = (() => {
    if (!periodFrom || !periodTo) return []
    const filtered = logs.filter((l) => l.log_date >= periodFrom && l.log_date <= periodTo)
    return isParent ? filtered : filtered.filter((l) => l.logged_by === member?.user_id)
  })()

  const filteredEntries = parentFilter
    ? summaryLogs.filter((l) => l.paying_parent === parentFilter)
    : summaryLogs

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
    const unbilledHours = carerLogs.filter((l) => !l.bill_id).reduce((s, l) => s + Number(l.hours_decimal), 0)
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
      unbilledHours,
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

  // Unbilled hours for whichever parent is currently selected — only meaningful
  // for a carer viewing their own already-self-scoped summaryLogs (a parent's
  // summaryLogs can span multiple carers with different rates, so a single
  // "create invoice" action wouldn't be unambiguous for them).
  const unbilledForSelectedParent = (!isParent && parentFilter)
    ? summaryLogs.filter((l) => l.paying_parent === parentFilter && !l.bill_id).reduce((s, l) => s + Number(l.hours_decimal), 0)
    : 0

  function fmt(majorUnits) {
    return new Intl.NumberFormat(regionConfig.locale, {
      style: 'currency',
      currency: regionConfig.currency.code,
    }).format(majorUnits)
  }

  // Invoiced (rolled into a bill, money not yet received) vs Paid (bill's been
  // marked paid) are different states, not synonyms — an entry's bill_id alone
  // only tells you it's been rolled up, not whether it's actually been settled.
  function entryStatus(log) {
    if (!log.bill_id) return null
    const bill = bills.find((b) => b.id === log.bill_id)
    return bill?.status === 'paid' ? 'Paid' : 'Invoiced'
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

      {/* Tabs */}
      <div className="flex gap-1.5">
        {[
          ...(isChildcare ? [{ id: 'log', label: 'Log hours' }] : []),
          { id: 'summary', label: 'Summary' },
          { id: 'bills', label: 'Invoices' },
        ].map((t) => (
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

      {/* ── Log form ─────────────────────────────────────────── */}
      {activeTab === 'log' && isChildcare && (
        <div className="space-y-3">

          {logError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{logError}</p>
          )}

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
                  {log.bill_id ? (
                    <span className={`shrink-0 text-xs py-1 ${entryStatus(log) === 'Paid' ? 'text-canopy-mid font-semibold' : 'text-gray-400'}`}>
                      {entryStatus(log)}
                    </span>
                  ) : (
                    <button
                      onClick={() => deleteLog(log.id)}
                      disabled={deleting === log.id}
                      className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-50 py-1"
                    >
                      {deleting === log.id ? '…' : 'Delete'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Summary ──────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="space-y-4">

          {billError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{billError}</p>
          )}

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
              {/* Per-parent totals — tap to filter Entries below to just that
                  parent's logs, tap the same one again to clear the filter */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setParentFilter((f) => (f === 'parent_a' ? null : 'parent_a'))}
                  className={`text-left bg-canopy-frost border rounded-2xl px-4 py-3 transition-colors ${
                    parentFilter === 'parent_a' ? 'border-canopy-green ring-2 ring-canopy-green' : 'border-canopy-mist'
                  }`}
                >
                  <p className="text-xs font-semibold text-canopy-green uppercase tracking-wide truncate">{paName}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatHours(paHours)}</p>
                  {paWages !== null && <p className="text-sm font-semibold text-canopy-mid mt-0.5">{fmt(paWages)}</p>}
                </button>
                <button
                  type="button"
                  onClick={() => setParentFilter((f) => (f === 'parent_b' ? null : 'parent_b'))}
                  className={`text-left bg-canopy-frost border rounded-2xl px-4 py-3 transition-colors ${
                    parentFilter === 'parent_b' ? 'border-canopy-green ring-2 ring-canopy-green' : 'border-canopy-mist'
                  }`}
                >
                  <p className="text-xs font-semibold text-canopy-green uppercase tracking-wide truncate">{pbName}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatHours(pbHours)}</p>
                  {pbWages !== null && <p className="text-sm font-semibold text-canopy-mid mt-0.5">{fmt(pbWages)}</p>}
                </button>
              </div>

              {/* Carer-only: create an invoice for just the selected parent's
                  unbilled hours. Parents don't get this action at all — they
                  only ever view entries/summary/invoice status. */}
              {!isParent && parentFilter && unbilledForSelectedParent > 0 && (
                <Button
                  className="w-full"
                  onClick={() => createBill(member.user_id, parentFilter)}
                  loading={billCreating === member.user_id}
                >
                  Create invoice for {formatHours(unbilledForSelectedParent)} unbilled ({parentFilter === 'parent_a' ? paName : pbName})
                </Button>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Total</p>
                <div className="text-right">
                  <p className="text-lg font-bold text-canopy-mid">{formatHours(grandTotalHours)}</p>
                  {grandTotalWages !== null && <p className="text-sm font-semibold text-gray-600">{fmt(grandTotalWages)}</p>}
                </div>
              </div>

              {/* Per-carer breakdown — parents only. A carer's own summaryLogs are
                  already filtered to just their own hours (see isParent ? filtered
                  : filtered.filter(...) above), so this would only ever show their
                  own single card under a "By carer" heading — pure redundant
                  repetition of the totals already shown above, not a real breakdown. */}
              {isParent && (carerBreakdown.length > 1 || carerBreakdown.some((c) => c.hasRate)) && (
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

              {/* Log entries — filtered to the selected parent, if any */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Entries</p>
                {filteredEntries.length === 0 && (
                  <p className="text-sm text-gray-400 py-2">No entries for {parentFilter === 'parent_a' ? paName : pbName} in this period.</p>
                )}
                {filteredEntries.map((log) => {
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
                        {entryStatus(log) && ` · ${entryStatus(log)}`}
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

      {/* ── Invoices ─────────────────────────────────────────── */}
      {activeTab === 'bills' && (
        <div className="space-y-3">
          {billError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{billError}</p>
          )}

          {bills.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">
              No invoices created yet. Create one from a carer's breakdown in Summary.
            </div>
          ) : (
            bills.map((bill) => (
              <div key={bill.id} className="bg-white border border-gray-200 rounded-2xl px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{memberName(bill.carer_id)}</p>
                    <p className="text-xs text-gray-500">{formatLogDate(bill.period_from)} – {formatLogDate(bill.period_to)}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    bill.status === 'paid' ? 'bg-canopy-mist text-canopy-deep' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {bill.status === 'paid' ? 'Paid' : 'Unpaid'}
                  </span>
                </div>

                <p className="text-xs text-gray-400">Owed by {bill.payer_role === 'parent_a' ? paName : pbName}</p>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{formatHours(bill.total_hours)}</span>
                  <span className="font-bold text-gray-900">
                    {bill.total_amount_pence != null ? fmt(bill.total_amount_pence / 100) : '— (no rate set)'}
                  </span>
                </div>

                {/* Carer-only: the parent only ever sees invoices and their status,
                    never acts on them. The carer this invoice belongs to marks it
                    paid/unpaid (confirming they've actually received the money)
                    and can delete it while still unpaid if created by mistake. */}
                {member?.user_id === bill.carer_id && (
                  <div className="flex gap-2 pt-1 border-t border-gray-100">
                    <button
                      onClick={() => toggleBillPaid(bill)}
                      disabled={billUpdating === bill.id}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 mt-1"
                    >
                      {billUpdating === bill.id ? '…' : bill.status === 'paid' ? 'Mark as unpaid' : 'Mark as paid'}
                    </button>
                    {bill.status === 'unpaid' && (
                      <button
                        onClick={() => removeBill(bill.id)}
                        disabled={billUpdating === bill.id}
                        className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-50 mt-1 px-2"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {billsHasMore && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={loadMoreBills}
              loading={billsLoadingMore}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
