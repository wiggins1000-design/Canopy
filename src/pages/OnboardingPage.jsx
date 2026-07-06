import { useState } from 'react'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'
import { SUPPORTED_LOCALES } from '../config/regions'
import { supabase } from '../lib/supabase'
import { buildPresetPattern, formatDate } from '../lib/scheduleEngine'
import { PLAN_IMPORT_STORAGE_KEY, PLAN_IMPORTED_FLAG, decodePlanImport } from '../lib/planImport'

function detectDefaultLocale() {
  const lang = navigator.language ?? 'en-GB'
  if (lang.startsWith('en-AU')) return 'en-AU'
  if (lang.startsWith('en-IE')) return 'en-IE'
  if (lang.startsWith('en-US')) return 'en-US'
  if (lang.startsWith('en-NZ')) return 'en-NZ'
  return 'en-GB'
}

// Applies a decoded plan-tool handoff (children + schedule) to a
// freshly-created family. Writes directly via Supabase rather than through
// FamilyContext's saveSchedule/updateFamilyConfig, since those callbacks are
// closed over the pre-creation (family: null) render and would still be
// stale immediately after createFamily() resolves in the same handler.
async function applyPlanImport(familyId, payload) {
  if (payload.children?.length) {
    const { data: familyRow } = await supabase.from('families').select('config').eq('id', familyId).single()
    const children = payload.children.map((c) => ({ id: crypto.randomUUID(), name: c.name }))
    await supabase.from('families').update({ config: { ...(familyRow?.config ?? {}), children } }).eq('id', familyId)

    for (const c of payload.children) {
      if (!c.dob) continue
      await supabase.from('info_bank').upsert(
        { family_id: familyId, child_name: c.name, section: 'personal', data: { dob: c.dob }, updated_at: new Date().toISOString() },
        { onConflict: 'family_id,child_name,section' }
      )
    }
  }

  if (payload.patternType && (payload.patternType !== 'custom' || payload.customCycle?.length)) {
    const patternData = payload.patternType === 'custom'
      ? { cycle: payload.customCycle }
      : buildPresetPattern(payload.patternType, payload.startingParent)
    await supabase.from('baseline_schedules').insert({
      family_id: familyId,
      pattern_type: payload.patternType,
      pattern_data: patternData,
      start_date: formatDate(new Date()), // the plan tool has no start-date field yet — default to today
      starting_parent: payload.startingParent,
    })
  }
}

export default function OnboardingPage() {
  const { createFamily, joinFamily, reload } = useFamily()
  const { user, signOut } = useAuth()
  const [step, setStep] = useState('choose') // 'choose' | 'create' | 'country' | 'join'
  const [inviteCode, setInviteCode] = useState('')
  const [selectedLocale, setSelectedLocale] = useState(detectDefaultLocale)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    setLoading(true)
    setError(null)
    const { error } = await createFamily(selectedLocale)
    if (error) { setError(error.message); setLoading(false); return }

    const raw = localStorage.getItem(PLAN_IMPORT_STORAGE_KEY)
    if (raw) {
      localStorage.removeItem(PLAN_IMPORT_STORAGE_KEY)
      const payload = decodePlanImport(raw)
      if (payload) {
        const { data: memberRow } = await supabase
          .from('family_members').select('family_id').eq('user_id', user.id).single()
        if (memberRow?.family_id) {
          await applyPlanImport(memberRow.family_id, payload)
          // OnboardingPage unmounts the instant `family` becomes truthy (AppLayout
          // swaps it out in the same render), so any confirmation state set here
          // would never paint — flag it for AppLayout to show once instead.
          localStorage.setItem(PLAN_IMPORTED_FLAG, 'true')
          await reload()
        }
      }
    }
    setLoading(false)
  }

  async function handleJoin() {
    if (!inviteCode.trim()) { setError('Enter the invite code.'); return }
    setLoading(true)
    setError(null)
    const { error } = await joinFamily(inviteCode.trim())
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/CanopyWhiteLogo.gif" alt="Canopy" className="h-12" />
          </div>
          <p className="text-gray-500 text-sm">Share what matters.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          {step === 'choose' && (
            <>
              <Button className="w-full py-3" onClick={() => setStep('create')}>
                Create a Canopy family
              </Button>
              <Button variant="secondary" className="w-full py-3" onClick={() => setStep('join')}>
                Join with an invite code
              </Button>
              <button
                className="text-xs text-gray-400 w-full text-center mt-2 hover:underline"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          )}

          {step === 'create' && (
            <>
              <button onClick={() => setStep('choose')} className="text-sm text-canopy-mid flex items-center gap-1 mb-1">
                ← Back
              </button>
              <p className="text-xs text-gray-400">
                You'll be set up as Parent A. Share an invite code from the People tab for Parent B to join.
              </p>
              <Button className="w-full py-3" onClick={() => setStep('country')}>
                Continue
              </Button>
            </>
          )}

          {step === 'country' && (
            <>
              <button onClick={() => setStep('create')} className="text-sm text-canopy-mid flex items-center gap-1 mb-1">
                ← Back
              </button>
              <p className="text-sm font-semibold text-gray-700">Where is your family based?</p>
              <p className="text-xs text-gray-400">This sets your currency and school calendar language.</p>
              <div className="space-y-2 pt-1">
                {SUPPORTED_LOCALES.map(({ code, label, flag }) => (
                  <button
                    key={code}
                    onClick={() => setSelectedLocale(code)}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors',
                      selectedLocale === code
                        ? 'border-canopy-green bg-canopy-green/5 text-canopy-dark'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300',
                    ].join(' ')}
                  >
                    <span className="text-xl">{flag}</span>
                    {label}
                    {selectedLocale === code && (
                      <span className="ml-auto text-canopy-green">✓</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center">More countries coming soon</p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full py-3" loading={loading} onClick={handleCreate}>
                Set up
              </Button>
            </>
          )}

          {step === 'join' && (
            <>
              <button onClick={() => setStep('choose')} className="text-sm text-canopy-mid flex items-center gap-1 mb-1">
                ← Back
              </button>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Invite code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD34"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-canopy-green"
                maxLength={8}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full py-3" loading={loading} onClick={handleJoin}>
                Join family
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
