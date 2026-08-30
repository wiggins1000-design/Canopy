import { useState, useCallback, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCalendar } from '../hooks/useCalendar'
import { useFamily } from '../context/FamilyContext'
import { useFamilyEvents } from '../hooks/useFamilyEvents'
import { useTermDates } from '../hooks/useTermDates'
import { useBirthdays } from '../hooks/useBirthdays'
import { usePeDays } from '../hooks/usePeDays'
import { formatDate } from '../lib/scheduleEngine'
import { shortSchoolName } from '../lib/termDatesUtils'
import CalendarGrid from '../components/calendar/CalendarGrid'
import DayDetailPanel from '../components/calendar/DayDetailPanel'
import ScheduleChangePanel from '../components/calendar/ScheduleChangePanel'
import FirstRefusalPanel from '../components/calendar/FirstRefusalPanel'
import NewEventSheet from '../components/calendar/NewEventSheet'
import SetupChecklist from '../components/calendar/SetupChecklist'
import WeekAheadPanel from '../components/calendar/WeekAheadPanel'
import ChildrenEventsPanel from '../components/calendar/ChildrenEventsPanel'

export default function CalendarPage() {
  const { calendarDays, viewDate, prevMonth, nextMonth, loading } = useCalendar()
  const { family, parentA, parentB, schedule, isParent } = useFamily()
  const dayByDateStr = useMemo(() => new Map(calendarDays.map((d) => [d.dateStr, d])), [calendarDays])
  const { events, eventDates, refetch: refetchEvents } = useFamilyEvents(viewDate.getFullYear(), viewDate.getMonth() + 1)
  const termDays = useTermDates(viewDate.getFullYear())
  const totalSchoolCount = useMemo(() => {
    const seen = new Set()
    for (const entries of termDays.values()) for (const s of entries) seen.add(s.schoolIndex)
    return seen.size
  }, [termDays])

  // Morning coverage needed: a school-morning handoff following a night the
  // kids spent with Parent A -- not the same as "days assigned to Parent A"
  // in the schedule, since a day can start with Parent A overnight and still
  // transition to Parent B later that same day. "School day" counts if ANY
  // tracked child's school is in session (not all of them need to be, since
  // a school run is still needed either way); falls back to every weekday
  // when no school terms are tracked at all, rather than showing nothing.
  const excludedMorningDates = useMemo(
    () => new Set(family?.config?.morning_coverage_excluded_dates ?? []),
    [family?.config?.morning_coverage_excluded_dates]
  )
  const morningEligibleDates = useMemo(() => {
    const set = new Set()
    for (const day of calendarDays) {
      const weekday = day.date.getDay()
      if (weekday === 0 || weekday === 6) continue

      const prevDate = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() - 1)
      const prevDay = dayByDateStr.get(formatDate(prevDate))
      if (!prevDay || prevDay.owner !== 'parent_a') continue

      const closedSchools = new Set((termDays.get(day.dateStr) ?? []).map((s) => s.schoolIndex))
      const isSchoolDay = totalSchoolCount === 0 || closedSchools.size < totalSchoolCount
      if (!isSchoolDay) continue

      set.add(day.dateStr)
    }
    return set
  }, [calendarDays, dayByDateStr, termDays, totalSchoolCount])
  const morningNeededDates = useMemo(
    () => new Set([...morningEligibleDates].filter((d) => !excludedMorningDates.has(d))),
    [morningEligibleDates, excludedMorningDates]
  )
  const birthdayList = useBirthdays()
  // Build a map of dateStr → child names for the current view year
  const birthdayDates = new Map()
  for (const { name, dob } of birthdayList) {
    const [, mm, dd] = dob.split('-')
    const dateStr = `${viewDate.getFullYear()}-${mm}-${dd}`
    if (!birthdayDates.has(dateStr)) birthdayDates.set(dateStr, [])
    birthdayDates.get(dateStr).push(name)
  }
  const peDaysList = usePeDays()
  // PE is a recurring weekly pattern (day-of-week), not specific dates — match it
  // against whichever dates are actually on screen for the current month view.
  // Skip any day already marked as a term-dates closure (holiday or INSET/PD day) -
  // school isn't in session, so there's no PE regardless of the usual weekday pattern.
  const peDates = new Map()
  for (const day of calendarDays) {
    if (termDays.has(day.dateStr)) continue
    const weekday = day.date.toLocaleDateString('en-US', { weekday: 'long' })
    const kids = peDaysList.filter((p) => p.peDays.includes(weekday)).map((p) => p.name)
    if (kids.length) peDates.set(day.dateStr, kids)
  }
  const [showSchoolDates, setShowSchoolDates] = useState(
    () => localStorage.getItem('canopy-show-school-dates') !== '0'
  )
  // Personal, per-device display filter for FamilyFeed-sourced events — independent of
  // the family-wide "which events to add" capture setting (Settings → FamilyFeed). That
  // setting controls what gets stored at all; this just controls what this parent sees,
  // same pattern as showSchoolDates above. "Just my kids" hides FamilyFeed events with no
  // tagged_children (untagged = didn't match a specific child, e.g. another year group's
  // event that slipped through under the family's "all events" capture setting).
  const [showAllFamilyFeedEvents, setShowAllFamilyFeedEvents] = useState(
    () => localStorage.getItem('canopy-show-all-familyfeed-events') !== '0'
  )
  const hasHideableFamilyFeedEvents = events.some(
    (e) => e.source === 'email_ai' && !(Array.isArray(e.tagged_children) && e.tagged_children.length > 0)
  )
  const visibleEvents = showAllFamilyFeedEvents
    ? events
    : events.filter((e) => e.source !== 'email_ai' || (Array.isArray(e.tagged_children) && e.tagged_children.length > 0))
  const visibleEventDates = showAllFamilyFeedEvents ? eventDates : new Set(visibleEvents.map((e) => e.event_date))
  const [calView, setCalView] = useState('month') // 'month' | 'week' | 'children'
  const hasChildren = (family?.config?.children ?? []).length > 0

  const [selectedDateStr, setSelectedDateStr] = useState(null)
  const selectedDay = selectedDateStr ? (calendarDays.find((d) => d.dateStr === selectedDateStr) ?? null) : null
  const [activePanel, setActivePanel] = useState(null) // 'change' | 'fror' | null
  const [showNewEvent, setShowNewEvent] = useState(false)

  // Schedule change state
  const [changeEndDateStr, setChangeEndDateStr] = useState(null)
  const [selectingEndDate, setSelectingEndDate] = useState(false)

  // FROR state
  const [frorSelectedDates, setFrorSelectedDates] = useState([])

  function handleSelectDay(date) {
    const dateStr = formatDate(date)

    if (selectingEndDate) {
      setChangeEndDateStr(dateStr)
      setSelectingEndDate(false)
      setActivePanel('change')
      return
    }

    if (selectedDateStr === dateStr) {
      setSelectedDateStr(null)
    } else {
      setSelectedDateStr(dateStr)
    }
  }

  function openChangePanel(day) {
    setChangeEndDateStr(null)
    setActivePanel('change')
  }

  function openFRORPanel(day) {
    setFrorSelectedDates(day ? [day.dateStr] : [])
    setActivePanel('fror')
  }

  function closePanel() {
    setActivePanel(null)
    setSelectingEndDate(false)
    setChangeEndDateStr(null)
    setFrorSelectedDates([])
  }

  function toggleFrorDate(dateStr) {
    setFrorSelectedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr],
    )
  }

  const pa = parentA?.display_name ?? 'Parent A'
  const pb = parentB?.display_name ?? 'Parent B'
  const navigate = useNavigate()

  const touchStartX = useRef(null)
  const touchStartY = useRef(null)

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
    dx < 0 ? nextMonth() : prevMonth()
  }

  return (
    <div className="px-3 pt-4 overflow-x-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <h1 className="text-xl font-bold text-gray-900 mb-3">Calendar</h1>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Previous month">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="text-lg font-bold text-gray-900">{format(viewDate, 'MMMM yyyy')}</span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/requests')}
            title="Requests history"
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 mr-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
          {termDays.size > 0 && (
            <button
              onClick={() => {
                const next = !showSchoolDates
                setShowSchoolDates(next)
                localStorage.setItem('canopy-show-school-dates', next ? '1' : '0')
              }}
              title={showSchoolDates ? 'Hide school dates' : 'Show school dates'}
              className={`relative p-2 rounded-xl hover:bg-gray-100 transition-colors ${showSchoolDates ? 'text-purple-500' : 'text-gray-300'}`}
            >
              <GradCapIcon className="w-5 h-5" />
            </button>
          )}
          {hasHideableFamilyFeedEvents && (
            <button
              onClick={() => {
                const next = !showAllFamilyFeedEvents
                setShowAllFamilyFeedEvents(next)
                localStorage.setItem('canopy-show-all-familyfeed-events', next ? '1' : '0')
              }}
              title={showAllFamilyFeedEvents ? 'Show only my kids’ events' : 'Show all events'}
              className={`relative p-2 rounded-xl hover:bg-gray-100 transition-colors ${showAllFamilyFeedEvents ? 'text-gray-300' : 'text-canopy-mid'}`}
            >
              <FilterIcon className="w-5 h-5" />
            </button>
          )}
          {isParent && (
            <button
              onClick={() => setShowNewEvent(true)}
              className="flex items-center gap-1 bg-canopy-mid text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-canopy-deep active:scale-95 transition-all mr-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Event
            </button>
          )}
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Next month">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-4">
        {['month', 'week', ...(hasChildren ? ['children'] : [])].map((v) => (
          <button
            key={v}
            onClick={() => setCalView(v)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              calView === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {v === 'month' ? 'Month' : v === 'week' ? 'Week ahead' : 'Children'}
          </button>
        ))}
      </div>

      <SetupChecklist />

      {/* Legend */}
      <div className="flex gap-4 mb-3 px-1 flex-wrap">
        <LegendDot color="bg-pa-400" label={pa} />
        <LegendDot color="bg-pb-400" label={pb} />
        <LegendDot color="bg-gray-500" label="Events" />
        {showSchoolDates && termDays.size > 0 && (() => {
          const seen = new Map()
          for (const entries of termDays.values()) {
            for (const s of entries) {
              if (!seen.has(s.schoolIndex)) seen.set(s.schoolIndex, s.schoolName)
            }
          }
          const STRIP_COLORS = ['bg-purple-400', 'bg-teal-400', 'bg-orange-400']
          return [...seen.entries()]
            .sort(([a], [b]) => a - b)
            .map(([idx, name]) => {
              const short = shortSchoolName(name) || 'School'
              return <LegendStrip key={idx} color={STRIP_COLORS[idx] ?? 'bg-gray-400'} label={short} />
            })
        })()}
        {!schedule && (
          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-2 py-1 ml-auto">
            No schedule set — go to Schedule tab
          </p>
        )}
      </div>

      {/* Selecting end date hint */}
      {selectingEndDate && (
        <div className="mb-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-canopy-deep font-medium">
          Tap a day on the calendar to set the end date
        </div>
      )}

      {calView === 'week' ? (
        <WeekAheadPanel />
      ) : calView === 'children' ? (
        <ChildrenEventsPanel />
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <CalendarGrid
            calendarDays={calendarDays}
            selectedDateStr={selectedDay?.dateStr ?? null}
            onSelectDay={handleSelectDay}
            selectingEndDate={selectingEndDate}
            eventDates={visibleEventDates}
            termDays={showSchoolDates ? termDays : null}
            birthdayDates={birthdayDates}
            morningNeededDates={morningNeededDates}
          />

          {/* Inline day detail */}
          {selectedDay && !selectingEndDate && (
            <DayDetailPanel
              day={selectedDay}
              dayEvents={visibleEvents.filter((e) => e.event_date === selectedDay.dateStr)}
              birthdayNames={birthdayDates.get(selectedDay.dateStr) ?? []}
              termSchools={termDays?.get(selectedDay.dateStr) ?? null}
              peNames={peDates.get(selectedDay.dateStr) ?? []}
              totalSchoolCount={totalSchoolCount}
              morningEligible={morningEligibleDates.has(selectedDay.dateStr)}
              morningNeeded={morningNeededDates.has(selectedDay.dateStr)}
              onRequestChange={openChangePanel}
              onOfferFROR={openFRORPanel}
              onClose={() => setSelectedDateStr(null)}
              onRefetchEvents={refetchEvents}
            />
          )}
        </>
      )}

      {/* Schedule change panel */}
      <ScheduleChangePanel
        open={activePanel === 'change'}
        onClose={closePanel}
        startDay={selectedDay}
        endDateStr={changeEndDateStr}
        onNeedEndDate={() => {
          setSelectingEndDate(true)
          setActivePanel(null) // temporarily close so calendar is fully visible
        }}
      />

      {/* FROR panel */}
      <FirstRefusalPanel
        open={activePanel === 'fror'}
        onClose={closePanel}
        calendarDays={calendarDays}
        selectedDates={frorSelectedDates}
        onToggleDate={toggleFrorDate}
      />

      {/* New event sheet */}
      <NewEventSheet
        open={showNewEvent}
        onClose={() => setShowNewEvent(false)}
        initialDate={selectedDay?.dateStr ?? formatDate(new Date())}
      />
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  )
}

function LegendStrip({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-4 h-[3px] rounded-full ${color}`} />
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  )
}

function GradCapIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3 2 8.5l10 5.5 10-5.5L12 3zm0 13.5L4 12v4.5c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5V12l-8 4.5z" />
    </svg>
  )
}

function FilterIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  )
}
