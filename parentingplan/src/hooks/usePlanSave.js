import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const DRAFT_KEY    = 'pp_draft'
const PLAN_ID_KEY  = 'pp_plan_id'
const PENDING_KEY  = 'pp_pending_save'
const LOCALE_KEY   = 'pp_locale'
export const REACHED_PAYWALL_KEY = 'pp_reached_paywall'
export const REACHED_PAYWALL_EVENT = 'pp:reached-paywall'

export function usePlanSave() {
  const { user, loading } = useAuth()
  const [planId, setPlanId] = useState(() => localStorage.getItem(PLAN_ID_KEY))
  const [saving, setSaving] = useState(false)
  // usePlanSave is instantiated once in App.jsx, outside PlanPage, so it has
  // no direct signal when the user reaches step 9 within the same session —
  // only localStorage, which effects don't re-read on their own. Without
  // this tick, the sign-in effect below only ever fires once (when
  // loading/user/planId first settle, before REACHED_PAYWALL_KEY exists) and
  // then never again in that session, permanently disabling the paywall
  // button. PlanPage dispatches REACHED_PAYWALL_EVENT the moment it sets the
  // flag so this effect gets a reason to re-check it.
  const [paywallTick, setPaywallTick] = useState(0)
  useEffect(() => {
    const bump = () => setPaywallTick(t => t + 1)
    window.addEventListener(REACHED_PAYWALL_EVENT, bump)
    return () => window.removeEventListener(REACHED_PAYWALL_EVENT, bump)
  }, [])

  // Reaching the paywall step shouldn't require checking email first — get an
  // anonymous (real, but password/email-free) session automatically so the
  // plan can be saved and the AI review can be paid for immediately.
  // "Save & share" later upgrades this same session to a permanent emailed
  // account rather than creating a separate identity — see SaveAndShare.
  useEffect(() => {
    if (loading || user || planId) return
    if (!localStorage.getItem(REACHED_PAYWALL_KEY)) return
    supabase.auth.signInAnonymously().catch((err) => console.error('signInAnonymously failed', err))
  }, [loading, user, planId, paywallTick])

  useEffect(() => {
    if (!user) return
    if (planId) return
    if (!localStorage.getItem(PENDING_KEY) && !localStorage.getItem(REACHED_PAYWALL_KEY)) return

    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) { localStorage.removeItem(PENDING_KEY); return }

    let data
    try { data = JSON.parse(raw) } catch { localStorage.removeItem(PENDING_KEY); return }

    const locale = localStorage.getItem(LOCALE_KEY) || 'en-gb'

    setSaving(true)
    supabase.rpc('pp_save_plan', {
      p_locale:    locale,
      p_p1_name:   data.parent1 || 'Parent 1',
      p_p2_name:   data.parent2 || 'Parent 2',
      p_plan_data: data,
    }).then(async ({ data: id, error }) => {
      setSaving(false)
      if (error) { console.error('pp_save_plan failed', error); return }
      localStorage.setItem(PLAN_ID_KEY, id)
      localStorage.removeItem(PENDING_KEY)
      setPlanId(id)
      // Auto-save Draft 1 so collaborators can see the baseline
      await supabase.rpc('pp_save_version', {
        p_plan_id:   id,
        p_plan_data: data,
        p_note:      `Draft 1 — ${data.parent1 || 'Parent 1'}`,
      })
    })
  }, [user, planId])

  return { planId, saving }
}
