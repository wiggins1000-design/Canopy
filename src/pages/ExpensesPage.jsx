import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExpenses } from '../hooks/useExpenses'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import { useLocale } from '../hooks/useLocale'
import NewExpenseSheet from '../components/expenses/NewExpenseSheet'
import { supabase } from '../lib/supabase'
import { firstName } from '../lib/childUtils'

const CATEGORY_LABELS = {
  education: 'Education',
  health:    'Health',
  clothing:  'Clothing',
  activities:'Activities',
  travel:    'Travel',
  food:      'Food',
  other:     'Other',
}

const CATEGORY_COLOURS = {
  education: 'bg-blue-100 text-blue-700',
  health:    'bg-red-100 text-red-700',
  clothing:  'bg-purple-100 text-purple-700',
  activities:'bg-orange-100 text-orange-700',
  travel:    'bg-cyan-100 text-cyan-700',
  food:      'bg-yellow-100 text-yellow-700',
  other:     'bg-gray-100 text-gray-600',
}

function formatMoney(pence, regionConfig) {
  return new Intl.NumberFormat(regionConfig.locale, {
    style: 'currency',
    currency: regionConfig.currency.code,
  }).format(Math.abs(pence) / 100)
}

function groupByMonth(expenses) {
  const groups = {}
  for (const e of expenses) {
    const key = e.expense_date.slice(0, 7)
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
}

function monthLabel(yyyyMM) {
  const [y, m] = yyyyMM.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

function formatHours(h) {
  const n = Number(h)
  if (!n) return '0h'
  const whole = Math.floor(n)
  const mins  = Math.round((n - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (whole === 0) return `${mins}m`
  return `${whole}h ${mins}m`
}

function ccDateRange(period, from, to) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const mon = (d) => { const day = d.getDay(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 0 ? -6 : 1 - day)) }
  if (period === 'this_week') { const s = mon(now); return { from: fmt(s), to: fmt(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)) } }
  if (period === 'this_month') return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (period === 'custom') return { from, to }
  return { from: '', to: '' }
}

export default function ExpensesPage() {
  const { unsettled, settled, loading, balancePence, otherParent, settleExpenses, createExpense, otherShare, myShare } = useExpenses()
  const { family, member, members, isParent, parentA, parentB } = useFamily()
  const { user } = useAuth()
  const regionConfig = useLocale()
  const navigate = useNavigate()
  const [tab, setTab] = useState('outstanding')
  const [showNew, setShowNew] = useState(false)
  const [settling, setSettling] = useState(false)
  const [childcareLogs, setChildcareLogs] = useState([])
  const [ccPeriod, setCcPeriod] = useState('this_month')
  const [ccFrom,   setCcFrom]   = useState('')
  const [ccTo,     setCcTo]     = useState('')

  const childcareMembers = family?.config?.childcare_members ?? []
  const isChildcare = childcareMembers.includes(member?.user_id)
  const myFeatures = member?.consents?.features ?? {}
  const childcareEnabled = isParent
    ? !!myFeatures.childcare
    : members.some((m) => (m.role === 'parent_a' || m.role === 'parent_b') && !!m.consents?.features?.childcare)
  const showChildcare = childcareEnabled && (isChildcare || (isParent && childcareMembers.length > 0))

  useEffect(() => {
    if (!showChildcare || !family?.id) return
    const { from, to } = ccDateRange(ccPeriod, ccFrom, ccTo)
    if (!from || !to) { setChildcareLogs([]); return }
    supabase
      .from('childcare_logs')
      .select('*')
      .eq('family_id', family.id)
      .gte('log_date', from)
      .lte('log_date', to)
      .order('log_date', { ascending: false })
      .then(({ data }) => setChildcareLogs(data ?? []))
  }, [showChildcare, family?.id, ccPeriod, ccFrom, ccTo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSettle() {
    setSettling(true)
    await settleExpenses()
    setSettling(false)
  }

  const displayList = tab === 'outstanding' ? unsettled : settled
  const groups = groupByMonth(displayList)
  const otherName = otherParent?.display_name ?? 'Other parent'

  const tabs = ['outstanding', 'history', ...(showChildcare ? ['childcare'] : [])]
  const tabLabel = (t) =>
    t === 'outstanding' ? `Outstanding${unsettled.length > 0 ? ` (${unsettled.length})` : ''}`
    : t === 'history'   ? 'History'
    : 'Childcare'

  return (
    <div className="px-4 pt-4 pb-24">

      <h1 className="text-xl font-bold text-gray-900 mb-3">Expenses</h1>

      {/* Balance banner — expense-specific, hidden on the Childcare tab */}
      {tab !== 'childcare' && !loading && (
        <div className={`rounded-2xl px-4 py-3.5 mb-3 ${
          balancePence > 0
            ? 'bg-canopy-frost border border-canopy-mist'
            : balancePence < 0
            ? 'bg-amber-50 border border-amber-200'
            : 'bg-gray-50 border border-gray-200'
        }`}>
          {balancePence === 0 ? (
            <p className="text-sm font-semibold text-gray-500 text-center">All settled up</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-lg font-bold ${balancePence > 0 ? 'text-canopy-deep' : 'text-amber-800'}`}>
                  {formatMoney(balancePence, regionConfig)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {balancePence > 0
                    ? `${otherName} owes you`
                    : `You owe ${otherName}`}
                  {unsettled.length > 0 && ` · ${unsettled.length} expense${unsettled.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              {unsettled.length > 0 && (
                <button
                  onClick={handleSettle}
                  disabled={settling}
                  className="shrink-0 bg-canopy-mid text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-canopy-deep active:scale-95 transition-all disabled:opacity-50"
                >
                  {settling ? 'Settling…' : 'Settle up'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs — Outstanding / History / Childcare, one view at a time */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-4">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {tab === 'childcare' ? (() => {
        const paName   = parentA?.display_name ?? 'Parent A'
        const pbName   = parentB?.display_name ?? 'Parent B'
        const rates    = family?.config?.childcare_rates ?? {}
        const paHours  = childcareLogs.filter((l) => l.paying_parent === 'parent_a').reduce((s, l) => s + Number(l.hours_decimal), 0)
        const pbHours  = childcareLogs.filter((l) => l.paying_parent === 'parent_b').reduce((s, l) => s + Number(l.hours_decimal), 0)
        const allHaveRate = childcareLogs.length > 0 && [...new Set(childcareLogs.map((l) => l.logged_by))].every((id) => (rates[id] ?? 0) > 0)
        const paWages  = allHaveRate ? childcareLogs.filter((l) => l.paying_parent === 'parent_a').reduce((s, l) => s + Number(l.hours_decimal) * (rates[l.logged_by] ?? 0) / 100, 0) : null
        const pbWages  = allHaveRate ? childcareLogs.filter((l) => l.paying_parent === 'parent_b').reduce((s, l) => s + Number(l.hours_decimal) * (rates[l.logged_by] ?? 0) / 100, 0) : null
        const fmt      = (p) => formatMoney(p * 100, regionConfig)

        return (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-900">Childcare hours</p>
              <button onClick={() => navigate('/childcare')} className="text-xs text-amber-700 hover:underline">
                {isChildcare ? 'Log hours →' : 'Full history →'}
              </button>
            </div>

            {/* Period selector */}
            <div className="flex gap-1.5">
              {[{ id: 'this_week', label: 'This week' }, { id: 'this_month', label: 'This month' }, { id: 'custom', label: 'Custom' }].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setCcPeriod(p.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${ccPeriod === p.id ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {ccPeriod === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide block mb-1">From</label>
                  <input type="date" value={ccFrom} onChange={(e) => setCcFrom(e.target.value)} className="w-full border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide block mb-1">To</label>
                  <input type="date" value={ccTo} onChange={(e) => setCcTo(e.target.value)} className="w-full border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </div>
              </div>
            )}

            {childcareLogs.length === 0 ? (
              <p className="text-xs text-amber-700">No hours logged this month.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/60 rounded-xl px-3 py-2">
                    <p className="text-xs font-semibold text-amber-700 truncate">{paName}</p>
                    <p className="text-lg font-bold text-amber-900">{formatHours(paHours)}</p>
                    {paWages !== null && <p className="text-xs font-semibold text-amber-700">{fmt(paWages)}</p>}
                  </div>
                  <div className="bg-white/60 rounded-xl px-3 py-2">
                    <p className="text-xs font-semibold text-amber-700 truncate">{pbName}</p>
                    <p className="text-lg font-bold text-amber-900">{formatHours(pbHours)}</p>
                    {pbWages !== null && <p className="text-xs font-semibold text-amber-700">{fmt(pbWages)}</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {childcareLogs.map((log) => {
                    const wages = (rates[log.logged_by] ?? 0) > 0
                      ? Number(log.hours_decimal) * rates[log.logged_by] / 100
                      : null
                    const carerName = members.find((m) => m.user_id === log.logged_by)?.display_name
                    return (
                      <div key={log.id} className="flex items-center justify-between text-xs">
                        <span className="text-amber-800">
                          {new Date(log.log_date + 'T00:00:00').toLocaleDateString(regionConfig.locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                          {carerName && isParent ? ` · ${carerName}` : ''}
                          {` · ${log.paying_parent === 'parent_a' ? paName : pbName} paying`}
                        </span>
                        <span className="font-semibold text-amber-900 shrink-0 ml-2">
                          {formatHours(log.hours_decimal)}{wages !== null ? ` = ${fmt(wages)}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })() : loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-4xl mb-3">💸</p>
          <p className="text-sm font-semibold text-gray-700">
            {tab === 'outstanding' ? 'No outstanding expenses' : 'No history yet'}
          </p>
          {tab === 'outstanding' && (
            <p className="text-xs text-gray-400 mt-1">Tap + to log a shared cost</p>
          )}
        </div>
      ) : (
        groups.map(([month, items]) => (
          <div key={month} className="mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
              {monthLabel(month)}
            </p>
            <div className="space-y-2">
              {items.map((e) => (
                <ExpenseCard key={e.id} expense={e} members={members} userId={user?.id} otherName={otherName} regionConfig={regionConfig} />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add button — logging an expense doesn't apply on the Childcare tab */}
      {tab !== 'childcare' && (
        <button
          onClick={() => setShowNew(true)}
          className="fixed bottom-20 right-4 w-14 h-14 bg-canopy-mid hover:bg-canopy-deep text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all z-20"
          aria-label="Log expense"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      <NewExpenseSheet
        open={showNew}
        onClose={() => setShowNew(false)}
        createExpense={createExpense}
        otherShare={otherShare}
        myShare={myShare}
      />
    </div>
  )
}

function ExpenseCard({ expense, members, userId, otherName, regionConfig }) {
  const paidByMe = expense.paid_by === userId
  const payer    = members.find((m) => m.user_id === expense.paid_by)
  const owedPence = Math.round(expense.amount_pence * expense.split_pct / 100)
  const [imgUrl, setImgUrl] = useState(null)

  useEffect(() => {
    if (!expense.receipt_url) return
    supabase.storage.from('notice-attachments').createSignedUrl(expense.receipt_url, 3600)
      .then(({ data }) => { if (data?.signedUrl) setImgUrl(data.signedUrl) })
  }, [expense.receipt_url])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{expense.description}</p>
            {expense.child_name && (
              <span className="text-xs text-canopy-mid bg-canopy-frost px-2 py-0.5 rounded-full shrink-0">{firstName(expense.child_name)}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLOURS[expense.category] ?? CATEGORY_COLOURS.other}`}>
              {CATEGORY_LABELS[expense.category] ?? expense.category}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(expense.expense_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
            <span className="text-xs text-gray-400">
              {paidByMe ? 'You paid' : `${payer?.display_name ?? 'Other'} paid`}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-gray-900">{formatMoney(expense.amount_pence, regionConfig)}</p>
          {expense.split_pct > 0 && (
            <p className={`text-xs mt-0.5 font-medium ${paidByMe ? 'text-canopy-mid' : 'text-amber-600'}`}>
              {paidByMe ? `${otherName} owes ${formatMoney(owedPence, regionConfig)}` : `You owe ${formatMoney(owedPence, regionConfig)}`}
            </p>
          )}
          {expense.split_pct === 0 && (
            <p className="text-xs mt-0.5 text-gray-400">No split</p>
          )}
        </div>
      </div>
      {imgUrl && (
        <img src={imgUrl} alt="Receipt" className="mt-2 rounded-xl w-full max-h-40 object-cover" />
      )}
    </div>
  )
}
