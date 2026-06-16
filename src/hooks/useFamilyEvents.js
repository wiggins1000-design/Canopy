import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { formatDate } from '../lib/scheduleEngine'

function expandRecurring(ev, from, to) {
  const instances = []
  let cur = new Date(ev.event_date + 'T00:00:00')
  const recEnd = ev.recurrence_end ? new Date(ev.recurrence_end + 'T00:00:00') : null
  const limit = recEnd && recEnd < to ? recEnd : to

  // Fast-forward to first candidate at or before `from`
  if (cur < from) {
    if (ev.recurrence === 'weekly' || ev.recurrence === 'fortnightly') {
      const stepDays = ev.recurrence === 'weekly' ? 7 : 14
      const steps = Math.floor((from - cur) / (stepDays * 86400000))
      cur.setDate(cur.getDate() + Math.max(0, steps - 1) * stepDays)
    } else if (ev.recurrence === 'monthly') {
      const months = (from.getFullYear() - cur.getFullYear()) * 12 + (from.getMonth() - cur.getMonth())
      cur.setMonth(cur.getMonth() + Math.max(0, months - 1))
    } else if (ev.recurrence === 'yearly') {
      cur.setFullYear(Math.max(cur.getFullYear(), from.getFullYear() - 1))
    }
  }

  let iters = 0
  while (cur <= limit && iters < 100) {
    iters++
    if (cur >= from) {
      instances.push({ ...ev, event_date: formatDate(cur) })
    }
    const prev = +cur
    if (ev.recurrence === 'weekly')           cur.setDate(cur.getDate() + 7)
    else if (ev.recurrence === 'fortnightly') cur.setDate(cur.getDate() + 14)
    else if (ev.recurrence === 'monthly')     cur.setMonth(cur.getMonth() + 1)
    else if (ev.recurrence === 'yearly')      cur.setFullYear(cur.getFullYear() + 1)
    if (+cur <= prev) break
  }
  return instances
}

export function useFamilyEvents(year, month) {
  const { family } = useFamily()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)

    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const fromDate = new Date(from + 'T00:00:00')
    const toDate   = new Date(to   + 'T00:00:00')

    // Two simple queries — no complex OR needed
    const [{ data: nonRecurring }, { data: allRecurring }] = await Promise.all([
      // Non-recurring events within this month only
      supabase.from('family_events').select('*')
        .is('recurrence', null)
        .gte('event_date', from)
        .lte('event_date', to)
        .order('event_date'),
      // All recurring events (date filtering is done client-side by expandRecurring)
      supabase.from('family_events').select('*')
        .not('recurrence', 'is', null),
    ])

    const expanded = (allRecurring ?? []).flatMap((ev) => expandRecurring(ev, fromDate, toDate))
    // Term dates are rendered as coloured strips via useTermDates — exclude them here
    const combined = [...(nonRecurring ?? []), ...expanded]
      .filter(ev => ev.source !== 'term_dates')
    combined.sort((a, b) => a.event_date.localeCompare(b.event_date))

    setEvents(combined)
    setLoading(false)
  }, [family?.id, year, month])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`family-events-${family.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'family_events',
        filter: `family_id=eq.${family.id}`,
      }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, load])

  const eventDates = new Set(events.map((e) => e.event_date))

  return { events, eventDates, loading, refetch: load }
}
