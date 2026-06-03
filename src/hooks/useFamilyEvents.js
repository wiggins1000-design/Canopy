import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

export function useFamilyEvents(year, month) {
  const { family } = useFamily()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)

    // Fetch events for the given month plus a small buffer
    const from = `${year}-${String(month).padStart(2, '0')}-01`
    // Last day of month: day 0 of next month
    const lastDay = new Date(year, month, 0).getDate()
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('family_events')
      .select('*')
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date', { ascending: true })

    if (error) console.error('useFamilyEvents error:', error)

    setEvents(data ?? [])
    setLoading(false)
  }, [family?.id, year, month])

  useEffect(() => { load() }, [load])

  // Realtime updates — new AI events appear instantly
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

  // Set of dateStr strings that have at least one event — used for calendar dots
  const eventDates = new Set(events.map((e) => e.event_date))

  return { events, eventDates, loading, refetch: load }
}
