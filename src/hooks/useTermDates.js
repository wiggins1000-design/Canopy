import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { buildTermDaysMap } from '../lib/termDatesUtils'

export function useTermDates(year) {
  const { family } = useFamily()
  const [termDays, setTermDays] = useState(new Map())

  useEffect(() => {
    if (!family?.id) return

    const from = `${year - 1}-01-01`
    const to   = `${year + 1}-12-31`

    supabase
      .from('family_events')
      .select('title, event_date, end_date, source_subject')
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
      .gte('event_date', from)
      .lte('event_date', to)
      .then(({ data }) => {
        setTermDays(buildTermDaysMap(data))
      })
  }, [family?.id, year])

  return termDays
}
