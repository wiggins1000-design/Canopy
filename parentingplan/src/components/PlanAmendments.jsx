import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getSectionText } from '../lib/planUtils'

const SECTIONS = [
  { key: 'residence',     label: 'Where the children live' },
  { key: 'holidays',      label: 'Holiday arrangements' },
  { key: 'special',       label: 'Special occasions' },
  { key: 'communication', label: 'Communication with children' },
  { key: 'childcare',     label: 'Childcare and carers' },
  { key: 'education',     label: 'Education decisions' },
  { key: 'medical',       label: 'Medical decisions' },
  { key: 'decisions',     label: 'Other major decisions' },
  { key: 'financial',     label: 'Financial arrangements' },
  { key: 'disputes',      label: 'Resolving disagreements' },
  { key: 'review',        label: 'Reviewing the plan' },
]

export default function PlanAmendments({ planId, planData }) {
  const { user } = useAuth()
  const [amendments,   setAmendments]   = useState([])
  const [openSection,  setOpenSection]  = useState(null)
  const [suggested,    setSuggested]    = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [resolving,    setResolving]    = useState(null)

  useEffect(() => {
    if (!planId) return
    supabase
      .from('pp_amendments')
      .select('*')
      .eq('plan_id', planId)
      .order('created_at')
      .then(({ data }) => { if (data) setAmendments(data) })
  }, [planId])

  async function suggestChange(section) {
    if (!suggested.trim() || !planId) return
    setSubmitting(true)
    const { error } = await supabase.rpc('pp_add_amendment', {
      p_plan_id:        planId,
      p_section:        section,
      p_field:          section,
      p_suggested_value: suggested.trim(),
    })
    if (!error) {
      const { data } = await supabase.from('pp_amendments').select('*').eq('plan_id', planId).order('created_at')
      if (data) setAmendments(data)
      setOpenSection(null)
      setSuggested('')
    }
    setSubmitting(false)
  }

  async function resolve(amendmentId, status) {
    setResolving(amendmentId)
    const { error } = await supabase.rpc('pp_resolve_amendment', {
      p_amendment_id: amendmentId,
      p_status:       status,
    })
    if (!error) {
      setAmendments(prev => prev.map(a => a.id === amendmentId ? { ...a, status } : a))
    }
    setResolving(null)
  }

  const pendingTotal = amendments.filter(a => a.status === 'pending').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#1b4332]">Suggested changes</h2>
        {pendingTotal > 0 && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">
            {pendingTotal} pending
          </span>
        )}
      </div>

      {SECTIONS.map(({ key, label }) => {
        const sectionAms = amendments.filter(a => a.section === key)
        const pending    = sectionAms.filter(a => a.status === 'pending')
        const isOpen     = openSection === key
        const preview    = getSectionText(planData, key)

        return (
          <div key={key} className="bg-white border border-[#d8f3dc] rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-sm font-medium text-[#1b4332] truncate">{label}</span>
                {pending.length > 0 && (
                  <span className="shrink-0 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                    {pending.length}
                  </span>
                )}
              </div>
              {!isOpen && (
                <button
                  onClick={() => { setOpenSection(key); setSuggested('') }}
                  className="shrink-0 text-xs text-[#52b788] hover:text-[#1b4332] font-medium transition-colors"
                >
                  + Suggest
                </button>
              )}
            </div>

            {/* Existing amendments */}
            {sectionAms.length > 0 && (
              <div className="border-t border-[#d8f3dc] divide-y divide-[#d8f3dc]">
                {sectionAms.map(am => (
                  <div key={am.id} className={`px-4 py-3 space-y-2.5 ${am.status === 'rejected' ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-xs text-gray-400">
                          {am.created_by === user?.id ? 'Your suggestion' : "Other parent's suggestion"}
                        </p>
                        <p className="text-sm text-gray-800 leading-relaxed">{am.suggested_value}</p>
                      </div>
                      <StatusBadge status={am.status} />
                    </div>
                    {am.status === 'pending' && am.created_by !== user?.id && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => resolve(am.id, 'accepted')}
                          disabled={!!resolving}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
                        >
                          {resolving === am.id ? '…' : 'Accept'}
                        </button>
                        <button
                          onClick={() => resolve(am.id, 'rejected')}
                          disabled={!!resolving}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Suggest form */}
            {isOpen && (
              <div className="border-t border-[#d8f3dc] px-4 py-3 space-y-3 bg-[#f4fbf4]">
                {preview && (
                  <div className="bg-white rounded-xl px-3 py-2.5 border border-[#d8f3dc]">
                    <p className="text-xs text-gray-400 mb-1">Current arrangement</p>
                    <p className="text-xs text-gray-700">{preview}</p>
                  </div>
                )}
                <textarea
                  value={suggested}
                  onChange={e => setSuggested(e.target.value)}
                  placeholder="Describe the change you'd like to suggest…"
                  rows={3}
                  className="w-full border border-[#95d5b2] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#52b788] bg-white resize-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => suggestChange(key)}
                    disabled={submitting || !suggested.trim()}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Sending…' : 'Send suggestion'}
                  </button>
                  <button
                    onClick={() => setOpenSection(null)}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }) {
  if (status === 'accepted') return <span className="shrink-0 text-xs bg-[#d8f3dc] text-[#1b4332] px-2 py-0.5 rounded-full font-medium">Accepted</span>
  if (status === 'rejected') return <span className="shrink-0 text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Rejected</span>
  return <span className="shrink-0 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Pending</span>
}
