import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/scheduleEngine'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

const CATEGORIES = [
  { value: 'education',  label: 'Education'  },
  { value: 'health',     label: 'Health'     },
  { value: 'clothing',   label: 'Clothing'   },
  { value: 'activities', label: 'Activities' },
  { value: 'travel',     label: 'Travel'     },
  { value: 'food',       label: 'Food'       },
  { value: 'other',      label: 'Other'      },
]

export default function NewExpenseSheet({ open, onClose, createExpense, otherShare, myShare }) {
  const { family, members, userRole } = useFamily()
  const { user } = useAuth()

  const [amountStr, setAmountStr]   = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory]     = useState('other')
  const [paidBySelf, setPaidBySelf] = useState(true)
  const [date, setDate]             = useState(formatDate(new Date()))
  const [childName, setChildName]   = useState('')
  const [splitPct, setSplitPct]     = useState(50)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)

  // Receipt scanning
  const [receiptPreview, setReceiptPreview] = useState(null)
  const [receiptPath, setReceiptPath]       = useState(null)
  const [extracting, setExtracting]         = useState(false)
  const fileInputRef = useRef(null)

  const otherParent = members.find(
    (m) => m.user_id !== user?.id && (m.role === 'parent_a' || m.role === 'parent_b')
  )
  const children = (family?.config?.children ?? []).filter((c) => c.name)

  // Recalculate default split when paidBySelf or role changes
  useEffect(() => {
    setSplitPct(paidBySelf ? otherShare : myShare)
  }, [paidBySelf, otherShare, myShare])

  function reset() {
    setAmountStr('')
    setDescription('')
    setCategory('other')
    setPaidBySelf(true)
    setDate(formatDate(new Date()))
    setChildName('')
    setSplitPct(otherShare)
    setReceiptPreview(null)
    setReceiptPath(null)
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Receipt photo ────────────────────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result
      setReceiptPreview(dataUrl)
      await Promise.all([
        extractFromReceipt(dataUrl, file.type),
        uploadReceipt(file),
      ])
    }
    reader.readAsDataURL(file)
  }

  async function extractFromReceipt(dataUrl, mimeType) {
    setExtracting(true)
    try {
      const base64 = dataUrl.split(',')[1]
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-event-from-image`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
        },
        body: JSON.stringify({ type: 'receipt', image_base64: base64, media_type: mimeType }),
      })
      if (!res.ok) return
      const json = await res.json()
      if (json.receipt) {
        const { amount_pence, date: d, description: desc, category: cat } = json.receipt
        if (amount_pence > 0) setAmountStr((amount_pence / 100).toFixed(2))
        if (d) setDate(d)
        if (desc) setDescription(desc)
        if (cat && CATEGORIES.some((c) => c.value === cat)) setCategory(cat)
      }
    } catch (e) {
      console.error('Receipt extraction error:', e)
    } finally {
      setExtracting(false)
    }
  }

  async function uploadReceipt(file) {
    if (!family?.id) return
    const ext  = file.name.split('.').pop() ?? 'jpg'
    const path = `receipts/${family.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('notice-attachments')
      .upload(path, file, { contentType: file.type })
    if (!upErr) setReceiptPath(path)
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    const amount_pence = Math.round(parseFloat(amountStr || '0') * 100)
    if (!amount_pence || amount_pence <= 0) { setError('Enter a valid amount.'); return }
    if (!description.trim()) { setError('Add a description.'); return }

    setSaving(true)
    setError(null)

    const { error: err } = await createExpense({
      amount_pence,
      split_pct:    splitPct,
      category,
      description:  description.trim(),
      expense_date: date,
      paid_by_self: paidBySelf,
      child_name:   childName || null,
      receipt_url:  receiptPath,
    })

    if (err) { setError(err.message); setSaving(false); return }
    handleClose()
  }

  const otherName = otherParent?.display_name ?? 'Other parent'
  // Label for split field: always "Other parent owes" from the payer's perspective
  const splitLabel = paidBySelf
    ? `${otherName} owes`
    : 'You owe'

  return (
    <BottomSheet open={open} onClose={handleClose} title="Log expense">
      <div className="px-4 pb-6 space-y-4">

        {/* Receipt scan button */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          {receiptPreview ? (
            <div className="relative">
              <img src={receiptPreview} alt="Receipt" className="w-full max-h-40 object-cover rounded-xl" />
              {extracting && (
                <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-canopy-deep font-medium">Reading receipt…</span>
                </div>
              )}
              <button
                onClick={() => { setReceiptPreview(null); setReceiptPath(null) }}
                className="absolute top-2 right-2 bg-white rounded-full p-1 shadow text-gray-500 hover:text-gray-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-canopy-mid hover:text-canopy-mid transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Scan receipt
            </button>
          )}
        </div>

        {/* Amount */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">£</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. School shoes, dentist co-pay"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Category */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Paid by */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Paid by</label>
          <div className="flex gap-2">
            <button
              onClick={() => setPaidBySelf(true)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                paidBySelf
                  ? 'border-canopy-mid bg-canopy-frost text-canopy-deep'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}
            >
              You
            </button>
            <button
              onClick={() => setPaidBySelf(false)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                !paidBySelf
                  ? 'border-canopy-mid bg-canopy-frost text-canopy-deep'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}
            >
              {otherName}
            </button>
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Child (optional) */}
        {children.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Child <span className="font-normal text-gray-400">(optional)</span></label>
            <select
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
            >
              <option value="">No specific child</option>
              {children.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Split */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{splitLabel}</label>
            <span className="text-sm font-bold text-gray-800">{splitPct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={splitPct}
            onChange={(e) => setSplitPct(Number(e.target.value))}
            className="w-full accent-canopy-mid"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span className="text-gray-500">
              {amountStr && splitPct > 0
                ? `${paidBySelf ? otherName : 'You'} owe £${(parseFloat(amountStr || '0') * splitPct / 100).toFixed(2)}`
                : 'No split'
              }
            </span>
            <span>100%</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full py-3" loading={saving} onClick={handleSave}>
          Save expense
        </Button>
      </div>
    </BottomSheet>
  )
}
