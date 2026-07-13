// FamilyContext — single source of truth for all family data.
//
// Loads family, members, and baseline schedule on mount (and whenever the
// authenticated user changes). All mutating operations go through RPCs or
// direct writes here so the rest of the app never touches Supabase directly
// for family-level data. A realtime channel keeps the schedule in sync across
// both parents' devices without polling.
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { setSentryLocale } from '../lib/sentry'
import { initRevenueCat } from '../lib/revenuecat'

const FamilyContext = createContext(null)

function firstNameOnly(name) {
  if (!name) return name
  return name.trim().split(/\s+/)[0]
}

export function FamilyProvider({ children }) {
  const { user } = useAuth()
  const [family, setFamily] = useState(null)
  const [member, setMember] = useState(null)   // current user's family_member row
  const [members, setMembers] = useState([])   // all family members
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadFamily = useCallback(async () => {
    if (!user) { setLoading(false); return }

    const { data: memberRow } = await supabase
      .from('family_members')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!memberRow) {
      setMember(null)
      setFamily(null)
      setLoading(false)
      return
    }

    setMember({ ...memberRow, display_name: firstNameOnly(memberRow.display_name) })

    const [
      { data: familyRow },
      { data: allMembers },
      { data: scheduleRow },
    ] = await Promise.all([
      supabase.from('families').select('*').eq('id', memberRow.family_id).single(),
      supabase.from('family_members').select('*').eq('family_id', memberRow.family_id),
      supabase.from('baseline_schedules').select('*').eq('family_id', memberRow.family_id).single(),
    ])

    setFamily(familyRow)
    setMembers((allMembers ?? []).map(m => ({ ...m, display_name: firstNameOnly(m.display_name) })))
    setSchedule(scheduleRow ?? null)
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadFamily()
  }, [loadFamily])

  // Realtime schedule updates
  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`family-schedule-${family.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'baseline_schedules',
        filter: `family_id=eq.${family.id}`,
      }, (payload) => {
        setSchedule(payload.new ?? null)
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id])

  const userRole = member?.role ?? null
  const isParent = userRole === 'parent_a' || userRole === 'parent_b'
  const parentA = members.find((m) => m.role === 'parent_a')
  const parentB = members.find((m) => m.role === 'parent_b')

  const createFamily = useCallback(async (locale = 'en-GB', careType = 'other') => {
    const displayName = user.user_metadata?.display_name ?? user.email
    const { error } = await supabase.rpc('create_family', {
      member_display_name: displayName,
      p_locale: locale,
      p_care_type: careType,
    })
    if (error) return { error }
    await loadFamily()
    return { error: null }
  }, [user, loadFamily])

  const joinFamily = useCallback(async (code) => {
    const { error } = await supabase.rpc('join_family', { p_code: code })
    if (error) return { error: new Error('Invalid or expired invite code') }
    await loadFamily()
    return { error: null }
  }, [loadFamily])

  const generateInvite = useCallback(async (role) => {
    const { data, error } = await supabase
      .from('family_invites')
      .insert({ family_id: family.id, role })
      .select()
      .single()
    return { data, error }
  }, [family?.id])

  const saveSchedule = useCallback(async (scheduleData) => {
    const payload = { ...scheduleData, family_id: family.id, updated_at: new Date().toISOString() }
    const { error } = schedule
      ? await supabase.from('baseline_schedules').update(payload).eq('family_id', family.id)
      : await supabase.from('baseline_schedules').insert(payload)
    if (!error) await loadFamily()
    return { error }
  }, [schedule, family?.id, loadFamily])

  const updateFamilyConfig = useCallback(async (partial) => {
    const merged = { ...family.config, ...partial }
    const { error } = await supabase.from('families').update({ config: merged }).eq('id', family.id)
    if (!error) setFamily((prev) => ({ ...prev, config: merged }))
    return { error }
  }, [family])

  // Silently capture the device's timezone once, so server-side jobs (e.g. the
  // evening reminder) know what "8pm" actually means for this family. Never
  // overwrites a value the family already has.
  useEffect(() => {
    if (!family?.id || family.config?.timezone) return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) updateFamilyConfig({ timezone: tz })
    } catch { /* Intl unsupported — server falls back to a locale-based default */ }
  }, [family?.id, family?.config?.timezone, updateFamilyConfig])

  useEffect(() => { setSentryLocale(family?.config?.locale) }, [family?.config?.locale])

  useEffect(() => { if (family?.id) initRevenueCat(family.id) }, [family?.id])

  const updateMemberFeatures = useCallback(async (features) => {
    const { error } = await supabase.rpc('update_member_features', { p_features: features })
    if (!error) {
      setMember((prev) => ({
        ...prev,
        consents: { ...(prev.consents ?? {}), features },
      }))
      setMembers((prev) => prev.map((m) =>
        m.user_id === member?.user_id
          ? { ...m, consents: { ...(m.consents ?? {}), features } }
          : m
      ))
    }
    return { error }
  }, [member])

  const proposePendingSchedule = useCallback(async ({ pattern_type, pattern_data, start_date, starting_parent }) => {
    const { error } = await supabase.rpc('propose_schedule_change', {
      p_pattern_type:    pattern_type,
      p_pattern_data:    pattern_data,
      p_start_date:      start_date,
      p_starting_parent: starting_parent,
    })
    if (!error) await loadFamily()
    return { error }
  }, [loadFamily])

  const respondToScheduleProposal = useCallback(async (accept) => {
    const { error } = await supabase.rpc('respond_to_schedule_proposal', { p_accept: accept })
    if (!error) await loadFamily()
    return { error }
  }, [loadFamily])

  const contextValue = useMemo(() => ({
    family, member, members, schedule, loading,
    userRole, isParent, parentA, parentB,
    createFamily, joinFamily, generateInvite, saveSchedule,
    proposePendingSchedule, respondToScheduleProposal,
    updateFamilyConfig, updateMemberFeatures, reload: loadFamily,
  }), [
    family, member, members, schedule, loading,
    userRole, isParent, parentA, parentB,
    createFamily, joinFamily, generateInvite, saveSchedule,
    proposePendingSchedule, respondToScheduleProposal,
    updateFamilyConfig, updateMemberFeatures, loadFamily,
  ])

  return (
    <FamilyContext.Provider value={contextValue}>
      {children}
    </FamilyContext.Provider>
  )
}

export function useFamily() {
  const ctx = useContext(FamilyContext)
  if (!ctx) throw new Error('useFamily must be inside FamilyProvider')
  return ctx
}
