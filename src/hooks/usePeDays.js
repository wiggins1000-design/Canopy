import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

// Returns [{ name, peDays: ['Monday', 'Wednesday'] }] for each child with PE days set,
// read from info_bank (section: 'school').
export function usePeDays() {
  const { family } = useFamily()
  const [peDays, setPeDays] = useState([])

  useEffect(() => {
    if (!family?.id) return
    supabase
      .from('info_bank')
      .select('child_name, data')
      .eq('family_id', family.id)
      .eq('section', 'school')
      .then(({ data }) => {
        const all = (data ?? [])
          .filter((r) => r.data?.pe_days?.length)
          .map((r) => ({ name: r.child_name, peDays: r.data.pe_days }))
        setPeDays(all)
      })
  }, [family?.id])

  return peDays
}
