import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import Button from '../components/ui/Button'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

const STATUS_LABELS = {
  pending:          { label: 'Uploaded — not yet analysed', colour: 'text-gray-500' },
  analyzing:        { label: 'Analysing…',                  colour: 'text-canopy-mid'  },
  needs_approval:   { label: 'Awaiting approval',           colour: 'text-amber-600' },
  active:           { label: 'Active — checks enabled',     colour: 'text-green-600' },
  failed:           { label: 'Analysis failed',             colour: 'text-red-600'   },
}

export default function CourtOrderPage() {
  const { family, isParent, members, member } = useFamily()
  const [orders, setOrders]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [analysing, setAnalysing] = useState(null)   // order id currently being analysed
  const [approving, setApproving] = useState(null)
  const [error, setError]         = useState(null)
  const fileInputRef = useRef(null)

  const paName = members.find(m => m.role === 'parent_a')?.display_name ?? 'Parent A'
  const pbName = members.find(m => m.role === 'parent_b')?.display_name ?? 'Parent B'

  useEffect(() => {
    if (!family?.id) return
    loadOrders()
    // Poll while analyzing
    const interval = setInterval(() => {
      if (orders.some(o => o.status === 'analyzing')) loadOrders()
    }, 3000)
    return () => clearInterval(interval)
  }, [family?.id, orders.some?.(o => o.status === 'analyzing')])

  async function loadOrders() {
    const { data } = await supabase
      .from('court_orders')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: false })
    setOrders(data ?? [])
    setLoading(false)
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)

    // Upload to vault storage
    const path = `${family.id}/court-orders/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('vault')
      .upload(path, file, { upsert: false })

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    // Create record
    const { data: order, error: dbErr } = await supabase
      .from('court_orders')
      .insert({
        family_id: family.id,
        file_url:  path,
        file_name: file.name,
        status:    'pending',
      })
      .select()
      .single()

    if (dbErr) {
      setError(dbErr.message)
      setUploading(false)
      return
    }

    setUploading(false)
    await loadOrders()

    // Auto-start analysis
    if (order) await startAnalysis(order.id)
  }

  async function startAnalysis(orderId) {
    setAnalysing(orderId)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${SUPABASE_URL}/functions/v1/analyze-court-order`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        SUPABASE_ANON,
        },
        body: JSON.stringify({ order_id: orderId }),
      })
      await loadOrders()
    } catch (e) {
      setError('Analysis failed — please try again.')
    }
    setAnalysing(null)
  }

  async function approve(orderId) {
    setApproving(orderId)
    await supabase.rpc('approve_court_order', { p_order_id: orderId })
    await loadOrders()
    setApproving(null)
  }

  async function deleteOrder(orderId, fileUrl) {
    await supabase.from('court_orders').delete().eq('id', orderId)
    if (fileUrl) await supabase.storage.from('vault').remove([fileUrl])
    await loadOrders()
  }

  if (!isParent) {
    return (
      <div className="px-4 py-8 text-center text-gray-400">
        <p className="text-sm">Only parents can view court order settings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const activeOrder = orders.find(o => o.status === 'active')

  return (
    <div className="px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Court order</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload your child arrangements order. Canopy will read it and flag any schedule changes or holiday requests that may conflict with its provisions.
        </p>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-xs text-amber-700 leading-relaxed">
          <strong>Advisory only.</strong> AI-generated checks are indicative and not legal advice. Always consult a solicitor for matters relating to court orders.
        </p>
      </div>

      {/* Upload */}
      {!activeOrder && (
        <section className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            className="w-full py-3"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Upload court order (PDF)'}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      )}

      {/* Orders list */}
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          paName={paName}
          pbName={pbName}
          currentUserId={member?.user_id}
          onAnalyse={() => startAnalysis(order.id)}
          onApprove={() => approve(order.id)}
          onDelete={() => deleteOrder(order.id, order.file_url)}
          analysing={analysing === order.id}
          approving={approving === order.id}
        />
      ))}

      {orders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No court order uploaded yet.</p>
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, paName, pbName, currentUserId, onAnalyse, onApprove, onDelete, analysing, approving }) {
  const [expanded, setExpanded] = useState(order.status === 'needs_approval' || order.status === 'active')
  const rules = order.raw_rules
  const statusInfo = STATUS_LABELS[order.status] ?? { label: order.status, colour: 'text-gray-500' }
  const alreadyApproved = order.approved_by?.includes(currentUserId)

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <DocumentIcon className="w-5 h-5 text-gray-400 shrink-0" />
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-800 truncate">{order.file_name ?? 'Court order'}</p>
            <p className={`text-xs ${statusInfo.colour}`}>{statusInfo.label}</p>
          </div>
        </div>
        <ChevronIcon className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">

          {/* Analysis error */}
          {order.status === 'failed' && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
              {order.error_msg ?? 'Analysis failed.'}
              <button onClick={onAnalyse} className="ml-2 underline text-red-600">Try again</button>
            </div>
          )}

          {/* Analysing spinner */}
          {(order.status === 'analyzing' || analysing) && (
            <div className="flex items-center gap-2 text-sm text-canopy-mid">
              <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin" />
              Reading the document with AI…
            </div>
          )}

          {/* Pending — start analysis */}
          {order.status === 'pending' && !analysing && (
            <Button className="w-full" onClick={onAnalyse}>
              Analyse with AI
            </Button>
          )}

          {/* Needs approval */}
          {order.status === 'needs_approval' && rules && !rules.error && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Awaiting approval from both parents ({order.approved_by?.length ?? 0}/2)
              </p>
              <div className="bg-white rounded-xl border border-amber-200 p-3 text-sm text-gray-700">
                <p className="font-semibold text-gray-800 mb-1">Summary</p>
                <p className="text-sm text-gray-600">{rules.summary}</p>
              </div>
              {!alreadyApproved && (
                <Button className="w-full" loading={approving} onClick={onApprove}>
                  Approve these rules
                </Button>
              )}
              {alreadyApproved && (
                <p className="text-sm text-green-600 text-center">✓ You've approved — waiting for the other parent</p>
              )}
            </div>
          )}

          {/* Active rules */}
          {order.status === 'active' && rules && !rules.error && (
            <RulesDisplay rules={rules} paName={paName} pbName={pbName} />
          )}

          {/* Delete */}
          <button
            onClick={onDelete}
            className="text-xs text-red-500 hover:underline"
          >
            Remove this order
          </button>
        </div>
      )}
    </div>
  )
}

function RulesDisplay({ rules, paName, pbName }) {
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Summary</p>
        <p className="text-sm text-gray-700">{rules.summary}</p>
      </div>

      {rules.holiday_entitlements?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Holiday entitlements</p>
          {rules.holiday_entitlements.map((h, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium text-gray-800">{h.period}:</span>
              {h.parent_a_days != null && <span className="text-gray-600"> {paName} — {h.parent_a_days} days</span>}
              {h.parent_b_days != null && <span className="text-gray-600">, {pbName} — {h.parent_b_days} days</span>}
              {h.advance_notice_days && <span className="text-gray-500"> (notice: {h.advance_notice_days} days)</span>}
              {h.notes && <p className="text-xs text-gray-400 mt-0.5">{h.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {rules.notice_requirements && (rules.notice_requirements.schedule_change_hours || rules.notice_requirements.holiday_request_days) && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notice requirements</p>
          {rules.notice_requirements.schedule_change_hours && (
            <p className="text-sm text-gray-700">Schedule changes: {rules.notice_requirements.schedule_change_hours}h advance notice</p>
          )}
          {rules.notice_requirements.holiday_request_days && (
            <p className="text-sm text-gray-700">Holiday requests: {rules.notice_requirements.holiday_request_days} days advance notice</p>
          )}
          {rules.notice_requirements.notes && <p className="text-xs text-gray-400">{rules.notice_requirements.notes}</p>}
        </div>
      )}

      {rules.geographic_restrictions && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Geographic restrictions</p>
          <p className="text-sm text-gray-700">{rules.geographic_restrictions}</p>
        </div>
      )}

      {rules.other_provisions?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Other provisions</p>
          <ul className="space-y-1">
            {rules.other_provisions.map((p, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-gray-400 shrink-0">•</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rules.confidence && rules.confidence !== 'high' && (
        <p className="text-xs text-amber-600">
          ⚠️ AI confidence: {rules.confidence}. Review these rules carefully before approving.
        </p>
      )}
    </div>
  )
}

function DocumentIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}
