import DayCell from './DayCell'
import { formatDate } from '../../lib/scheduleEngine'

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const todayStr = formatDate(new Date())

export default function CalendarGrid({ calendarDays, selectedDateStr, onSelectDay, selectingEndDate, eventDates, termDays, birthdayDates, morningNeededMap }) {
  return (
    <div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => (
          <DayCell
            key={day.dateStr}
            {...day}
            selected={day.dateStr === selectedDateStr}
            isToday={day.dateStr === todayStr}
            onSelect={onSelectDay}
            selectingEndDate={selectingEndDate}
            isTransition={day.isTransition}
            changeoverTime={day.changeoverTime}
            hasEvents={eventDates?.has(day.dateStr) ?? false}
            termSchools={termDays?.get(day.dateStr) ?? null}
            isBirthday={birthdayDates?.has(day.dateStr) ?? false}
            morningNeededRole={morningNeededMap?.get(day.dateStr) ?? null}
          />
        ))}
      </div>
    </div>
  )
}
