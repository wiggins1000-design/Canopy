import { useEffect, useState } from 'react'
import { format, addDays, parseISO, isToday, isTomorrow } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { formatDate } from '../../lib/scheduleEngine'

function labelDate(dateStr) {
  const d = parseISO(dateStr)
  if (isToday(d)) return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  return format(d, 'EEE d MMM')
}

export default function ChildrenEventsPanel() {
  const { family } = useFamily()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const children = family?.config?.children ?? []

  useEffect(() => {
    if (!family?.id) return
    const today = formatDate(new Date())
    const end = formatDate(addDays(new Date(), 30))
    supabase
      .from('family_events')
      .select('id, title, event_date, event_time, end_time, notes, tagged_children, recurrence')
      .eq('family_id', family.id)
      .not('tagged_children', 'is', null)
      .gte('event_date', today)
      .lte('event_date', end)
      .order('event_date')
      .then(({ data }) => {
        setEvents(data ?? [])
        setLoading(false)
      })
  }, [family?.id])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        Add children in Settings to use this view.
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-6">
      {children.map((child) => {
        const childEvents = events.filter((ev) => ev.tagged_children?.includes(child.name))
        return (
          <div key={child.name}>
            <h2 className="text-sm font-bold text-gray-900 mb-2 px-1">{child.name}</h2>
            {childEvents.length === 0 ? (
              <p className="text-xs text-gray-400 px-1">No tagged events in the next 30 days.</p>
            ) : (
              <div className="space-y-2">
                {childEvents.map((ev) => (
                  <div key={ev.id} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 flex gap-3 items-start">
                    <div className="shrink-0 text-center w-12">
                      <p className="text-[10px] font-semibold text-canopy-mid uppercase">{labelDate(ev.event_date)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{ev.title}</p>
                      {ev.event_time && (
                        <p className="text-xs text-gray-500">
                          {ev.event_time}{ev.end_time ? ` – ${ev.end_time}` : ''}
                        </p>
                      )}
                      {ev.notes && <p className="text-xs text-gray-500 mt-0.5">{ev.notes}</p>}
                      {ev.recurrence && <p className="text-[10px] text-gray-400 mt-0.5">↻ {ev.recurrence}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
