import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

function classifyTermEvent(title, endDate) {
  const lower = title.toLowerCase()
  if (lower.includes('inset')) return 'inset'
  if (endDate) return 'holiday'   // Range = holiday / half-term / break
  return 'term'                   // Single day = term start or end boundary
}

function priority(type) {
  return type === 'inset' ? 3 : type === 'term' ? 2 : 1
}

export function useTermDates(year) {
  const { family } = useFamily()
  const [termDays, setTermDays] = useState(new Map())

  useEffect(() => {
    if (!family?.id) return

    // Wide window: previous year through next year covers any cross-year holidays
    const from = `${year - 1}-01-01`
    const to   = `${year + 1}-12-31`

    supabase
      .from('family_events')
      .select('title, event_date, end_date')
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
      .gte('event_date', from)
      .lte('event_date', to)
      .then(({ data }) => {
        const map = new Map()
        for (const event of data ?? []) {
          const type  = classifyTermEvent(event.title, event.end_date)
          const start = new Date(event.event_date + 'T00:00:00')
          const end   = event.end_date
            ? new Date(event.end_date + 'T00:00:00')
            : new Date(event.event_date + 'T00:00:00')

          const cur = new Date(start)
          while (cur <= end) {
            const ds = cur.toISOString().split('T')[0]
            if (!map.has(ds) || priority(type) > priority(map.get(ds))) {
              map.set(ds, type)
            }
            cur.setDate(cur.getDate() + 1)
          }
        }
        setTermDays(map)
      })
  }, [family?.id, year])

  return termDays
}
