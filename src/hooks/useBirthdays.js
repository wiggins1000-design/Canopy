import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

export function useBirthdays() {
  const { family } = useFamily()
  const [birthdays, setBirthdays] = useState([]) // [{ name, dob }]

  useEffect(() => {
    if (!family?.id) return
    Promise.all([
      supabase.from('info_bank').select('child_name, data').eq('family_id', family.id).eq('section', 'personal'),
      supabase.from('info_bank').select('child_name, data').eq('family_id', family.id).eq('section', 'vet'),
    ]).then(([{ data: personal }, { data: vet }]) => {
      const all = [
        ...(personal ?? []).filter((r) => r.data?.dob).map((r) => ({ name: r.child_name, dob: r.data.dob })),
        ...(vet ?? []).filter((r) => r.data?.dob).map((r) => ({ name: r.child_name, dob: r.data.dob })),
      ]
      setBirthdays(all)
    })
  }, [family?.id])

  return birthdays
}
