import { formatDate } from '../../lib/scheduleEngine'

const OWNER_BG = {
  parent_a: 'bg-pa-100',
  parent_b: 'bg-pb-100',
}
const OWNER_TEXT = {
  parent_a: 'text-pa-900',
  parent_b: 'text-pb-900',
}
const OWNER_RING = {
  parent_a: 'ring-pa-400',
  parent_b: 'ring-pb-400',
}

/**
 * Single day cell in the calendar grid.
 */
const TERM_STRIP = {
  holiday: 'bg-purple-400',
  inset:   'bg-amber-400',
  term:    'bg-green-400',
}

export default function DayCell({ date, dateStr, current, owner, type, change, offer, selected, onSelect, isToday, selectingEndDate, isTransition, changeoverTime, hasEvents, termType }) {
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
      {termType && (
        <span className={`absolute top-0 inset-x-0 h-[3px] rounded-t-xl ${TERM_STRIP[termType]}`} />
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
        {hasEvents && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
      </div>
    </button>
  )
}
