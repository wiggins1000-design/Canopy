import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

function classifyTermEvent(title, endDate) {
  const lower = title.toLowerCase()
  if (lower.includes('inset')) return 'inset'
  if (endDate) return 'holiday'
  return null
}

function typePriority(type) {
  return type === 'inset' ? 2 : type === 'holiday' ? 1 : 0
}

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
        // Assign stable school indices (alphabetical by name)
        const rawNames = [...new Set((data ?? []).map(e => e.source_subject ?? 'School'))]
        rawNames.sort()
        const schoolIndex = Object.fromEntries(rawNames.map((name, i) => [name, i]))

        const map = new Map()
        for (const event of data ?? []) {
          const type = classifyTermEvent(event.title, event.end_date)
          if (!type) continue
          const schoolName = event.source_subject ?? 'School'
          const idx = schoolIndex[schoolName] ?? 0
          const start = new Date(event.event_date + 'T00:00:00')
          const end   = event.end_date
            ? new Date(event.end_date + 'T00:00:00')
            : new Date(event.event_date + 'T00:00:00')

          const cur = new Date(start)
          while (cur <= end) {
            const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
            const existing = map.get(ds) ?? []
            const schoolEntry = existing.find(e => e.schoolIndex === idx)
            if (!schoolEntry) {
              map.set(ds, [...existing, { type, schoolIndex: idx, schoolName }])
            } else if (typePriority(type) > typePriority(schoolEntry.type)) {
              // INSET overrides holiday for the same school on the same day
              map.set(ds, existing.map(e => e.schoolIndex === idx ? { ...e, type } : e))
            }
            cur.setDate(cur.getDate() + 1)
          }
        }
        setTermDays(map)
      })
  }, [family?.id, year])

  return termDays
}
