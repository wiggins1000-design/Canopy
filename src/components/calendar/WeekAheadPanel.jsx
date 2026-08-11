import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { getDayState, formatDate } from '../../lib/scheduleEngine'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function buildWeekDays() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    return d
  })
}

export default function WeekAheadPanel() {
  const { family, schedule, scheduleHistory, userRole, parentA, parentB } = useFamily()
  const [showOtherDays, setShowOtherDays] = useState(false)
  const [changes, setChanges] = useState([])
  const [offers, setOffers] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const days = buildWeekDays()
  const startStr = formatDate(days[0])
  const endStr = formatDate(days[6])
  const todayStr = startStr

  useEffect(() => {
    if (!family?.id) return
    setLoading(true)
    Promise.all([
      supabase
        .from('schedule_changes')
        .select('*')
        .eq('family_id', family.id)
        .lte('start_date', endStr)
        .gte('end_date', startStr),
      supabase
        .from('fror_offers')
        .select('*')
        .eq('family_id', family.id)
        .neq('status', 'expired'),
      supabase
        .from('family_events')
        .select('id, event_date, title, event_time')
        .eq('family_id', family.id)
        .gte('event_date', startStr)
        .lte('event_date', endStr)
        .order('event_time', { ascending: true, nullsFirst: false }),
    ]).then(([{ data: ch }, { data: of }, { data: ev }]) => {
      setChanges(ch ?? [])
      setOffers(of ?? [])
      setEvents(ev ?? [])
      setLoading(false)
    })
  }, [family?.id, startStr, endStr])

  const otherName = userRole === 'parent_a'
    ? (parentB?.display_name ?? 'Other parent')
    : (parentA?.display_name ?? 'Other parent')

  const dayData = days.map(date => {
    const dateStr = formatDate(date)
    const state = getDayState(dateStr, { schedule, changes, offers, history: scheduleHistory })
    const isMyDay = state.owner === userRole
    const dayEvents = events.filter(e => e.event_date === dateStr)
    return { date, dateStr, isToday: dateStr === todayStr, owner: state.owner, isMyDay, dayEvents }
  })

  const hasMyDays = dayData.some(d => d.isMyDay)
  const displayDays = showOtherDays || !hasMyDays
    ? dayData
    : dayData.filter(d => d.isMyDay)

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-gray-500">
          {showOtherDays || !hasMyDays
            ? 'All 7 days'
            : `Your ${displayDays.length} day${displayDays.length !== 1 ? 's' : ''} this week`}
        </p>
        <button
          onClick={() => setShowOtherDays(v => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors ${
            showOtherDays
              ? 'bg-canopy-mid text-white'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {showOtherDays ? 'My days only' : `Include ${otherName}`}
        </button>
      </div>

      {!hasMyDays && (
        <p className="text-xs text-gray-400 text-center mb-3">
          None of the next 7 days are yours — showing all
        </p>
      )}

      <div className="space-y-2">
        {displayDays.map(({ date, dateStr, isToday, isMyDay, owner, dayEvents }) => (
          <DayRow
            key={dateStr}
            date={date}
            isToday={isToday}
            isMyDay={isMyDay}
            owner={owner}
            dayEvents={dayEvents}
            otherName={otherName}
          />
        ))}
      </div>
    </div>
  )
}

function DayRow({ date, isToday, isMyDay, owner, dayEvents, otherName }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${
      isToday
        ? 'bg-canopy-frost border-canopy-light'
        : isMyDay
        ? 'bg-white border-gray-100'
        : 'bg-gray-50 border-gray-100'
    }`}>
      <div className="flex items-start gap-3">
        {/* Date column */}
        <div className={`shrink-0 text-center w-9 ${
          isToday ? 'text-canopy-deep' : isMyDay ? 'text-gray-700' : 'text-gray-400'
        }`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide leading-tight">
            {DAY_NAMES[date.getDay()]}
          </p>
          <p className="text-2xl font-bold leading-tight">{date.getDate()}</p>
          <p className="text-[11px] text-gray-400 leading-tight">{MONTH_NAMES[date.getMonth()]}</p>
        </div>

        {/* Vertical divider */}
        <div className={`w-px self-stretch mx-0.5 ${isMyDay ? 'bg-canopy-mist' : 'bg-gray-200'}`} />

        {/* Day content */}
        <div className="flex-1 min-w-0 py-0.5">
          <p className={`text-xs font-semibold mb-1.5 ${
            isMyDay ? 'text-canopy-mid' : 'text-gray-400'
          }`}>
            {owner === null
              ? 'No schedule set'
              : isMyDay
              ? 'Your day'
              : `${otherName}'s day`}
          </p>
          {dayEvents.length === 0 ? (
            <p className="text-xs text-gray-300">No events</p>
          ) : (
            <div className="space-y-1">
              {dayEvents.map(e => (
                <div key={e.id} className="flex items-baseline gap-2">
                  {e.event_time ? (
                    <span className="text-[11px] text-gray-400 shrink-0 w-10 tabular-nums">
                      {e.event_time.slice(0, 5)}
                    </span>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                  <span className={`text-xs truncate ${isMyDay ? 'text-gray-700' : 'text-gray-400'}`}>
                    {e.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
