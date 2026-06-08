import { useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCalendar } from '../hooks/useCalendar'
import { useFamily } from '../context/FamilyContext'
import { useFamilyEvents } from '../hooks/useFamilyEvents'
import { useTermDates } from '../hooks/useTermDates'
import { formatDate } from '../lib/scheduleEngine'
import CalendarGrid from '../components/calendar/CalendarGrid'
import DayDetailPanel from '../components/calendar/DayDetailPanel'
import ScheduleChangePanel from '../components/calendar/ScheduleChangePanel'
import FirstRefusalPanel from '../components/calendar/FirstRefusalPanel'
import NewEventSheet from '../components/calendar/NewEventSheet'
import SetupChecklist from '../components/calendar/SetupChecklist'

export default function CalendarPage() {
  const { calendarDays, viewDate, prevMonth, nextMonth, loading } = useCalendar()
  const { parentA, parentB, schedule, isParent } = useFamily()
  const { events, eventDates, refetch: refetchEvents } = useFamilyEvents(viewDate.getFullYear(), viewDate.getMonth() + 1)
  const termDays = useTermDates(viewDate.getFullYear())
  const [showSchoolDates, setShowSchoolDates] = useState(
    () => localStorage.getItem('canopy-show-school-dates') !== '0'
  )

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
    <div className="px-3 pt-4" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Previous month">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <h1 className="text-lg font-bold text-gray-900">{format(viewDate, 'MMMM yyyy')}</h1>

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
          {isParent && (
            <button
              onClick={() => setShowNewEvent(true)}
              className="flex items-center gap-1 bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-blue-700 active:scale-95 transition-all mr-1"
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

      <SetupChecklist />

      {/* Legend */}
      <div className="flex gap-4 mb-3 px-1 flex-wrap">
        <LegendDot color="bg-pa-400" label={pa} />
        <LegendDot color="bg-pb-400" label={pb} />
        <LegendDot color="bg-teal-400" label="Events" />
        {showSchoolDates && termDays.size > 0 && (
          <>
            <LegendStrip color="bg-purple-400" label="Holiday" />
            <LegendStrip color="bg-amber-400"  label="INSET"   />
          </>
        )}
        {!schedule && (
          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-2 py-1 ml-auto">
            No schedule set — go to Schedule tab
          </p>
        )}
      </div>

      {/* Selecting end date hint */}
      {selectingEndDate && (
        <div className="mb-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-sm text-blue-700 font-medium">
          Tap a day on the calendar to set the end date
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <CalendarGrid
            calendarDays={calendarDays}
            selectedDateStr={selectedDay?.dateStr ?? null}
            onSelectDay={handleSelectDay}
            selectingEndDate={selectingEndDate}
            eventDates={eventDates}
            termDays={showSchoolDates ? termDays : null}
          />

          {/* Inline day detail */}
          {selectedDay && !selectingEndDate && (
            <DayDetailPanel
              day={selectedDay}
              dayEvents={events.filter((e) => e.event_date === selectedDay.dateStr)}
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
