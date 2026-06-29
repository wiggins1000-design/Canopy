import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const DRAFT_KEY   = 'pp_draft'
const PLAN_ID_KEY = 'pp_plan_id'
const PENDING_KEY = 'pp_pending_save'
const LOCALE_KEY  = 'pp_locale'

export function usePlanSave() {
  const { user } = useAuth()
  const [planId, setPlanId] = useState(() => localStorage.getItem(PLAN_ID_KEY))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    if (planId) return
    if (!localStorage.getItem(PENDING_KEY)) return

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
    }).then(({ data: id, error }) => {
      setSaving(false)
      if (error) { console.error('pp_save_plan failed', error); return }
      localStorage.setItem(PLAN_ID_KEY, id)
      localStorage.removeItem(PENDING_KEY)
      setPlanId(id)
    })
  }, [user, planId])

  return { planId, saving }
}
