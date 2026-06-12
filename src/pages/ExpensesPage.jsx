import { useState, useEffect } from 'react'
import { useExpenses } from '../hooks/useExpenses'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import NewExpenseSheet from '../components/expenses/NewExpenseSheet'
import { supabase } from '../lib/supabase'

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

function formatPounds(pence) {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`
}

function groupByMonth(expenses) {
  const groups = {}
  for (const e of expenses) {
    const key = e.expense_date.slice(0, 7) // YYYY-MM
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

export default function ExpensesPage() {
  const { unsettled, settled, loading, balancePence, otherParent, settleExpenses } = useExpenses()
  const { members } = useFamily()
  const { user } = useAuth()
  const [tab, setTab] = useState('outstanding')
  const [showNew, setShowNew] = useState(false)
  const [settling, setSettling] = useState(false)

  async function handleSettle() {
    setSettling(true)
    await settleExpenses()
    setSettling(false)
  }

  const displayList = tab === 'outstanding' ? unsettled : settled
  const groups = groupByMonth(displayList)

  const otherName = otherParent?.display_name ?? 'Other parent'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 mb-3">Expenses</h1>

        {/* Balance banner */}
        {!loading && (
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
                    {formatPounds(balancePence)}
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

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {['outstanding', 'history'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t === 'outstanding' ? `Outstanding${unsettled.length > 0 ? ` (${unsettled.length})` : ''}` : 'History'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
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
                  <ExpenseCard key={e.id} expense={e} members={members} userId={user?.id} otherName={otherName} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add button */}
      <div className="px-4 pb-4 shrink-0">
        <button
          onClick={() => setShowNew(true)}
          className="w-full flex items-center justify-center gap-2 bg-canopy-mid text-white font-semibold py-3 rounded-2xl hover:bg-canopy-deep active:scale-95 transition-all text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Log expense
        </button>
      </div>

      <NewExpenseSheet open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}

function ExpenseCard({ expense, members, userId, otherName }) {
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
              <span className="text-xs text-canopy-mid bg-canopy-frost px-2 py-0.5 rounded-full shrink-0">{expense.child_name}</span>
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
          <p className="text-sm font-bold text-gray-900">{formatPounds(expense.amount_pence)}</p>
          {expense.split_pct > 0 && (
            <p className={`text-xs mt-0.5 font-medium ${paidByMe ? 'text-canopy-mid' : 'text-amber-600'}`}>
              {paidByMe ? `${otherName} owes ${formatPounds(owedPence)}` : `You owe ${formatPounds(owedPence)}`}
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
