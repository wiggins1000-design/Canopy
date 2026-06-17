import { formatDate } from '../../lib/scheduleEngine'

const OWNER_BG = {
  parent_a: 'bg-pa-400',
  parent_b: 'bg-pb-400',
}
const OWNER_TEXT = {
  parent_a: 'text-pa-900',
  parent_b: 'text-pb-900',
}
const OWNER_RING = {
  parent_a: 'ring-pa-700',
  parent_b: 'ring-pb-700',
}

// School 0 = purple, 1 = teal, 2 = orange. Lighter shade for INSET.
const SCHOOL_STRIP = [
  { holiday: 'bg-purple-400', inset: 'bg-purple-200' },
  { holiday: 'bg-teal-400',   inset: 'bg-teal-200'   },
  { holiday: 'bg-orange-400', inset: 'bg-orange-200' },
]
const STRIP_FALLBACK = { holiday: 'bg-gray-400', inset: 'bg-gray-200' }

export default function DayCell({ date, dateStr, current, owner, type, change, offer, selected, onSelect, isToday, selectingEndDate, isTransition, changeoverTime, hasEvents, termSchools, isBirthday }) {
  const isOffered = type === 'offered' || type === 'offer_accepted'
  const isPending = type === 'change_pending'

  const bg = owner ? OWNER_BG[owner] : 'bg-white'
  const txt = owner ? OWNER_TEXT[owner] : 'text-gray-400'
  const ringColor = owner ? OWNER_RING[owner] : 'ring-gray-300'

  return (
    <button
      onClick={() => onSelect(date)}
      className={[
        'relative aspect-square flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all',
        current ? txt : 'text-gray-300',
        bg,
        isOffered ? 'day-offered' : '',
        selected ? `ring-2 ${ringColor} ring-offset-1` : '',
        isToday ? 'font-bold underline underline-offset-2' : '',
        selectingEndDate && current ? 'cursor-crosshair' : '',
        'hover:opacity-80 active:scale-95',
      ].filter(Boolean).join(' ')}
      aria-label={dateStr}
    >
      {termSchools?.length > 0 && (
        <div className="absolute top-0 inset-x-0 flex flex-col rounded-t-xl overflow-hidden">
          {termSchools.map((s, i) => {
            const palette = SCHOOL_STRIP[s.schoolIndex] ?? STRIP_FALLBACK
            return <span key={i} className={`h-[3px] w-full ${palette[s.type] ?? palette.holiday}`} />
          })}
        </div>
      )}

      {isBirthday && (
        <svg
          className="absolute top-0 inset-x-0 w-full pointer-events-none"
          height="10"
          viewBox="0 0 44 10"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="1" y1="1.5" x2="43" y2="1.5" stroke="#d1d5db" strokeWidth="0.7"/>
          <polygon points="1,1.5 7.5,1.5 4.25,9" fill="#ef4444"/>
          <polygon points="8.5,1.5 15,1.5 11.75,9" fill="#f59e0b"/>
          <polygon points="16,1.5 22.5,1.5 19.25,9" fill="#3b82f6"/>
          <polygon points="23.5,1.5 30,1.5 26.75,9" fill="#22c55e"/>
          <polygon points="31,1.5 37.5,1.5 34.25,9" fill="#ec4899"/>
          <polygon points="38.5,1.5 43,1.5 40.75,9" fill="#f97316"/>
        </svg>
      )}

      {date.getDate()}

      {isTransition && changeoverTime && (
        <span className="text-[8px] font-semibold leading-none mt-0.5 opacity-80">{changeoverTime}</span>
      )}

      {/* Indicator dots */}
      <div className="absolute bottom-1 flex gap-0.5">
        {isPending && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
        {isOffered && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
        {type === 'change_accepted' && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {type === 'offer_accepted' && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {hasEvents && <span className="w-1.5 h-1.5 rounded-full bg-canopy-mid" />}
      </div>
    </button>
  )
}
