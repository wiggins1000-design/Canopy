import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

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

  async function createFamily() {
    const displayName = user.user_metadata?.display_name ?? user.email
    const { error } = await supabase.rpc('create_family', {
      member_display_name: displayName,
    })
    if (error) return { error }
    await loadFamily()
    return { error: null }
  }

  async function joinFamily(code) {
    const { data: invite, error: ie } = await supabase
      .from('family_invites')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (ie || !invite) return { error: new Error('Invalid or expired invite code') }

    const displayName = user.user_metadata?.display_name ?? user.email
    const { error: me } = await supabase.from('family_members').insert({
      family_id: invite.family_id,
      user_id: user.id,
      role: invite.role,
      display_name: displayName,
    })
    if (me) return { error: me }

    await supabase.from('family_invites').update({ used: true, used_by: user.id }).eq('id', invite.id)
    await loadFamily()
    return { error: null }
  }

  async function generateInvite(role) {
    const { data, error } = await supabase
      .from('family_invites')
      .insert({ family_id: family.id, role })
      .select()
      .single()
    return { data, error }
  }

  async function saveSchedule(scheduleData) {
    const payload = { ...scheduleData, family_id: family.id, updated_at: new Date().toISOString() }
    const { error } = schedule
      ? await supabase.from('baseline_schedules').update(payload).eq('family_id', family.id)
      : await supabase.from('baseline_schedules').insert(payload)
    if (!error) await loadFamily()
    return { error }
  }

  async function updateFamilyConfig(partial) {
    const merged = { ...family.config, ...partial }
    const { error } = await supabase.from('families').update({ config: merged }).eq('id', family.id)
    if (!error) setFamily((prev) => ({ ...prev, config: merged }))
    return { error }
  }

  return (
    <FamilyContext.Provider value={{
      family, member, members, schedule, loading,
      userRole, isParent, parentA, parentB,
      createFamily, joinFamily, generateInvite, saveSchedule, updateFamilyConfig, reload: loadFamily,
    }}>
      {children}
    </FamilyContext.Provider>
  )
}

export function useFamily() {
  const ctx = useContext(FamilyContext)
  if (!ctx) throw new Error('useFamily must be inside FamilyProvider')
  return ctx
}
