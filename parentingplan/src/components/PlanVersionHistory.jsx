import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { getSectionText } from '../lib/planUtils'

const SECTIONS = [
  'residence', 'holidays', 'special', 'communication',
  'childcare', 'education', 'medical', 'decisions', 'financial', 'disputes', 'review',
]

const SECTION_LABELS = {
  residence: 'Where the children live', holidays: 'Holiday arrangements',
  special: 'Special occasions', communication: 'Communication with children',
  childcare: 'Childcare and carers', education: 'Education decisions',
  medical: 'Medical decisions', decisions: 'Other major decisions',
  financial: 'Financial arrangements', disputes: 'Resolving disagreements',
  review: 'Reviewing the plan',
}

export default function PlanVersionHistory({ planId, currentPlanData }) {
  const [versions,  setVersions]  = useState([])
  const [expanded,  setExpanded]  = useState(null)  // version_number being viewed
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)
  const [open,      setOpen]      = useState(false)

  useEffect(() => {
    if (!planId) return
    supabase
      .from('pp_versions')
      .select('id, version_number, plan_data, note, created_at')
      .eq('plan_id', planId)
      .order('version_number', { ascending: false })
      .then(({ data }) => { if (data) setVersions(data) })
  }, [planId])

  async function saveVersion() {
    if (!planId || !currentPlanData) return
    setSaving(true)
    const { data: versionNumber, error } = await supabase.rpc('pp_save_version', {
      p_plan_id:   planId,
      p_plan_data: currentPlanData,
      p_note:      note.trim() || null,
    })
    setSaving(false)
    if (!error) {
      const newVersion = {
        version_number: versionNumber,
        plan_data: currentPlanData,
        note: note.trim() || null,
        created_at: new Date().toISOString(),
      }
      setVersions(prev => [newVersion, ...prev])
      setNote('')
    }
  }

  const latestVersionNumber = versions[0]?.version_number ?? 1

  return (
    <div className="bg-white border border-[#d8f3dc] rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#f4fbf4] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-[#52b788] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-semibold text-[#1b4332]">Version history</span>
          <span className="text-xs text-gray-400">{versions.length} snapshot{versions.length !== 1 ? 's' : ''}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#d8f3dc]">
          {/* Save new version */}
          <div className="px-4 py-3 space-y-2 bg-[#f4fbf4]">
            <p className="text-xs text-gray-500">Save a snapshot of the current plan state</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional note (e.g. 'After mediation session')"
                className="flex-1 border border-[#d8f3dc] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#52b788] bg-white"
              />
              <button
                onClick={saveVersion}
                disabled={saving || !currentPlanData}
                className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save snapshot'}
              </button>
            </div>
          </div>

          {/* Version list */}
          {versions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400">No snapshots yet</div>
          ) : (
            <div className="divide-y divide-[#d8f3dc]">
              {versions.map(v => (
                <div key={v.version_number}>
                  {/* Version row */}
                  <button
                    onClick={() => setExpanded(expanded === v.version_number ? null : v.version_number)}
                    className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-[#f4fbf4] transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1b4332]">
                          v{v.version_number}
                          {v.version_number === latestVersionNumber && (
                            <span className="ml-1.5 text-[10px] bg-[#d8f3dc] text-[#1b4332] px-1.5 py-0.5 rounded-full font-medium">latest</span>
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">{format(new Date(v.created_at), 'd MMM yyyy, HH:mm')}</p>
                      {v.note && <p className="text-xs text-gray-500 italic">"{v.note}"</p>}
                    </div>
                    <svg className={`w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0 transition-transform ${expanded === v.version_number ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded version detail */}
                  {expanded === v.version_number && (
                    <div className="px-4 pb-4 space-y-2 bg-[#f4fbf4]">
                      {SECTIONS.map(key => {
                        const text = getSectionText(v.plan_data, key)
                        if (!text) return null
                        return (
                          <div key={key} className="bg-white rounded-xl px-3 py-2.5 border border-[#d8f3dc]">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{SECTION_LABELS[key]}</p>
                            <p className="text-xs text-gray-700">{text}</p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
