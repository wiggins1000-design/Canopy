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

export default function DayCell({ date, dateStr, current, owner, type, change, offer, selected, onSelect, isToday, selectingEndDate, isTransition, changeoverTime, hasEvents, termSchools, isBirthday, peNames }) {
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

      {peNames?.length > 0 && (
        <BallIcon
          className="absolute top-0.5 right-0.5 w-3 h-3"
          title={`${peNames.map((n) => n.split(' ')[0]).join(' & ')} - PE`}
        />
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

// PE / sport day flag — same "small icon on the day cell" pattern as the mortarboard
// toggle uses for term dates, just scoped to this one cell instead of a page-level toggle.
// Volleyball icon (Streamline Solar, streamlinehq.com — src/assets/icons/volleyball.svg),
// rendered in black so it reads clearly against any custody-colour day background.
function BallIcon({ className, title }) {
  return (
    <svg className={className} viewBox="-0.75 -0.75 24 24" fill="none">
      {title && <title>{title}</title>}
      <path d="m10.846593749999998 11.768625 0.5549999999999999 0.43171875000000004 -0.5549999999999999 -0.43171875000000004Zm-0.23953125 -8.35063125 0.6490312500000001 0.27043125 -0.6490312500000001 -0.27043125ZM17.3953125 13.59796875c0.2611875 -0.28734375 0.24 -0.7320000000000001 -0.047343750000000004 -0.9932812500000001 -0.28734375 -0.2611875 -0.7320000000000001 -0.24 -0.9932812500000001 0.047343750000000004l1.0406250000000001 0.9459374999999999Zm-0.7934062500000001 -0.17259375000000002 -0.52021875 -0.47296874999999994 0.52021875 0.47296874999999994Zm3.31303125 -3.3541875 0.5012812499999999 -0.49312500000000004 -0.00403125 -0.00403125 -0.49724999999999997 0.49715624999999997Zm0.19734374999999998 1.2031875c0.27234375 0.27684375 0.71746875 0.28040624999999997 0.9943124999999999 0.0080625 0.27684375 -0.27225 0.2805 -0.71746875 0.00815625 -0.9943124999999999l-1.00246875 0.9862500000000001ZM5.374406250000001 17.852625c-0.38833124999999996 0 -0.703125 0.3148125 -0.703125 0.703125s0.31479375000000004 0.703125 0.703125 0.703125v-1.40625ZM3.28125 14.765625c-0.38832187500000004 0 -0.703125 0.3148125 -0.703125 0.703125s0.31480312499999996 0.703125 0.703125 0.703125v-1.40625ZM7.6802906250000005 3.146015625c0.149353125 -0.35845312500000004 -0.020156249999999997 -0.770109375 -0.37860937499999997 -0.919471875 -0.35845312500000004 -0.149353125 -0.770109375 0.020156249999999997 -0.919471875 0.37860937499999997l1.29808125 0.5408625ZM6.382209375 14.332968750000001c0.14936249999999998 0.35840625 0.5610187499999999 0.52790625 0.919471875 0.37856249999999997 0.35845312500000004 -0.14934375 0.5279625 -0.561 0.37860937499999997 -0.9195l-1.29808125 0.5409375ZM10.3125 5.390625c-0.3883125 0 -0.703125 0.31480312499999996 -0.703125 0.703125s0.3148125 0.703125 0.703125 0.703125v-1.40625Zm8.32125 10.468125c0.21534375 0.32315625000000003 0.6519375000000001 0.4104375 0.9750000000000001 0.19499999999999998 0.32315625000000003 -0.21534375 0.4104375 -0.6519375000000001 0.19499999999999998 -0.9750000000000001l-1.17 0.7799999999999999ZM11.25 19.921875c-4.7893406249999995 0 -8.671875 -3.8825625 -8.671875 -8.671875h-1.40625c0 5.56603125 4.51213125 10.078125 10.078125 10.078125v-1.40625ZM19.921875 11.25c0 4.7893125 -3.8825625 8.671875 -8.671875 8.671875v1.40625c5.56603125 0 10.078125 -4.51209375 10.078125 -10.078125h-1.40625ZM11.25 2.578125c4.7893125 0 8.671875 3.882534375 8.671875 8.671875h1.40625c0 -5.56599375 -4.51209375 -10.078125 -10.078125 -10.078125v1.40625Zm0 -1.40625C5.68400625 1.171875 1.171875 5.68400625 1.171875 11.25h1.40625c0 -4.7893406249999995 3.882534375 -8.671875 8.671875 -8.671875v-1.40625Zm0 10.78125h0.08596875000000001v-1.40625H11.25v1.40625Zm-0.5549999999999999 -1.13484375 -0.40340625 0.51871875 1.1099999999999999 0.8633437500000001 0.40340625 -0.518625 -1.1099999999999999 -0.8634375000000001Zm-0.09403125 -9.2137125 -0.6429374999999999 1.542984375 1.2980625000000001 0.540871875 0.6429374999999999 -1.5429937500000002 -1.2980625000000001 -0.5408625ZM16.3546875 12.65203125l-0.273 0.300375 1.0405312500000001 0.9459374999999999 0.27309375 -0.300375 -1.0406250000000001 -0.9459374999999999Zm3.0590625 -2.08771875 0.6985312499999999 0.7100624999999999 1.00246875 -0.9862500000000001 -0.6985312499999999 -0.7099687499999999 -1.00246875 0.9861562500000001Zm-3.3320624999999997 2.38809375c-2.6906250000000003 2.9596875000000002 -6.7433812500000005 4.90021875 -10.70728125 4.90021875v1.40625c4.395375 0 8.815312500000001 -2.13478125 11.7478125 -5.36053125l-1.0405312500000001 -0.9459374999999999ZM9.95803125 3.147553125c-1.154540625 2.7709593750000003 -0.895265625 5.929528125 0.6957187499999999 8.475103125l1.1925000000000001 -0.7453125c-1.34953125 -2.159259375 -1.56946875 -4.838484375 -0.5901562499999999 -7.18891875l-1.2980625000000001 -0.540871875Zm0.3335625 8.189446875C8.608996875 13.50028125 6.02188125 14.765625 3.28125 14.765625v1.40625c3.1745812499999997 0 6.171374999999999 -1.4656874999999998 8.12034375 -3.97153125l-1.1099999999999999 -0.8633437500000001ZM6.382209375 2.605153125c-1.5721125 3.7730812499999997 -1.5721125 7.954659375 0 11.727815625l1.29808125 -0.5409375c-1.4278875 -3.42684375 -1.4278875 -7.2190875 0 -10.646015625l-1.29808125 -0.5408625ZM10.3125 6.796875c3.4151249999999997 0 6.690375 1.3566562500000001 9.10528125 3.7715625l0.9944062499999999 -0.9944062499999999C17.7335625 6.895443749999999 14.100562499999999 5.390625 10.3125 5.390625v1.40625Zm1.02346875 5.15625c2.9325 0 5.67103125 1.46559375 7.29778125 3.9056250000000006l1.17 -0.7799999999999999c-1.88746875 -2.83125 -5.0650312500000005 -4.531874999999999 -8.46778125 -4.531874999999999v1.40625Z" fill="black" />
    </svg>
  )
}
