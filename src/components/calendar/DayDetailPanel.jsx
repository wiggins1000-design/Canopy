import { useState } from 'react'
import { format } from 'date-fns'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { useLocale } from '../../hooks/useLocale'
import { supabase } from '../../lib/supabase'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import EditEventSheet from './EditEventSheet'
import { shortSchoolName } from '../../lib/termDatesUtils'
import { firstName } from '../../lib/childUtils'

const OWNER_COLORS = {
  parent_a: 'text-pa-700 bg-pa-50 border-pa-200',
  parent_b: 'text-pb-700 bg-pb-50 border-pb-200',
}

const SCHOOL_COLORS = [
  'text-purple-700 bg-purple-50 border-purple-200',
  'text-teal-700 bg-teal-50 border-teal-200',
  'text-orange-700 bg-orange-50 border-orange-200',
]

export default function DayDetailPanel({ day, dayEvents = [], birthdayNames = [], termSchools = null, totalSchoolCount = 0, peNames = [], morningEligible = false, morningNeeded = false, onRequestChange, onOfferFROR, onClose, onRefetchEvents }) {
  const { userRole, parentA, parentB, isParent, updateFamilyConfig, family } = useFamily()
  const regionConfig = useLocale()
  const [editingChangeover, setEditingChangeover] = useState(false)
  const [draftTime, setDraftTime] = useState('')
  const [draftLocation, setDraftLocation] = useState('')
  const [savingChangeover, setSavingChangeover] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [savingMorning, setSavingMorning] = useState(false)

  if (!day) return null

  const { date, owner, type, change, offer, isTransition, changeoverTime, changeoverLocation, dateStr } = day
  const ownerMember = owner === 'parent_a' ? parentA : parentB
  const ownerLabel = ownerMember?.display_name ?? (owner === 'parent_a' ? 'Parent A' : owner === 'parent_b' ? 'Parent B' : '—')
  const isMyDay = userRole === owner

  // Morning coverage veto -- only ever shown for a day the auto-rule flagged
  // at all (morningEligible); toggling just adds/removes this one date from
  // the family's exclusion list, independent of the rule re-computing it.
  async function toggleMorningException() {
    setSavingMorning(true)
    const current = family?.config?.morning_coverage_excluded_dates ?? []
    const next = morningNeeded ? [...current, dateStr] : current.filter((d) => d !== dateStr)
    await updateFamilyConfig({ morning_coverage_excluded_dates: next })
    setSavingMorning(false)
  }

  return (
    <div className={`mt-3 rounded-2xl border p-4 ${owner ? OWNER_COLORS[owner] : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900">{format(date, 'EEEE, d MMMM yyyy')}</p>
          <p className="text-sm mt-0.5">
            <span className="font-medium">{ownerLabel}</span>
            {!owner && <span className="text-gray-400"> — no schedule set yet</span>}
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-black/10 text-gray-500 shrink-0" aria-label="Close">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Birthday banner */}
      {birthdayNames.length > 0 && (
        <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="text-base">🎂</span>
          <p className="text-sm font-medium text-yellow-800">
            {birthdayNames.map(firstName).join(' & ')}'s birthday!
          </p>
        </div>
      )}

      {/* PE / sport day reminder */}
      {peNames.length > 0 && (
        <div className="mt-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" viewBox="-0.75 -0.75 24 24" fill="none">
            <path d="m10.846593749999998 11.768625 0.5549999999999999 0.43171875000000004 -0.5549999999999999 -0.43171875000000004Zm-0.23953125 -8.35063125 0.6490312500000001 0.27043125 -0.6490312500000001 -0.27043125ZM17.3953125 13.59796875c0.2611875 -0.28734375 0.24 -0.7320000000000001 -0.047343750000000004 -0.9932812500000001 -0.28734375 -0.2611875 -0.7320000000000001 -0.24 -0.9932812500000001 0.047343750000000004l1.0406250000000001 0.9459374999999999Zm-0.7934062500000001 -0.17259375000000002 -0.52021875 -0.47296874999999994 0.52021875 0.47296874999999994Zm3.31303125 -3.3541875 0.5012812499999999 -0.49312500000000004 -0.00403125 -0.00403125 -0.49724999999999997 0.49715624999999997Zm0.19734374999999998 1.2031875c0.27234375 0.27684375 0.71746875 0.28040624999999997 0.9943124999999999 0.0080625 0.27684375 -0.27225 0.2805 -0.71746875 0.00815625 -0.9943124999999999l-1.00246875 0.9862500000000001ZM5.374406250000001 17.852625c-0.38833124999999996 0 -0.703125 0.3148125 -0.703125 0.703125s0.31479375000000004 0.703125 0.703125 0.703125v-1.40625ZM3.28125 14.765625c-0.38832187500000004 0 -0.703125 0.3148125 -0.703125 0.703125s0.31480312499999996 0.703125 0.703125 0.703125v-1.40625ZM7.6802906250000005 3.146015625c0.149353125 -0.35845312500000004 -0.020156249999999997 -0.770109375 -0.37860937499999997 -0.919471875 -0.35845312500000004 -0.149353125 -0.770109375 0.020156249999999997 -0.919471875 0.37860937499999997l1.29808125 0.5408625ZM6.382209375 14.332968750000001c0.14936249999999998 0.35840625 0.5610187499999999 0.52790625 0.919471875 0.37856249999999997 0.35845312500000004 -0.14934375 0.5279625 -0.561 0.37860937499999997 -0.9195l-1.29808125 0.5409375ZM10.3125 5.390625c-0.3883125 0 -0.703125 0.31480312499999996 -0.703125 0.703125s0.3148125 0.703125 0.703125 0.703125v-1.40625Zm8.32125 10.468125c0.21534375 0.32315625000000003 0.6519375000000001 0.4104375 0.9750000000000001 0.19499999999999998 0.32315625000000003 -0.21534375 0.4104375 -0.6519375000000001 0.19499999999999998 -0.9750000000000001l-1.17 0.7799999999999999ZM11.25 19.921875c-4.7893406249999995 0 -8.671875 -3.8825625 -8.671875 -8.671875h-1.40625c0 5.56603125 4.51213125 10.078125 10.078125 10.078125v-1.40625ZM19.921875 11.25c0 4.7893125 -3.8825625 8.671875 -8.671875 8.671875v1.40625c5.56603125 0 10.078125 -4.51209375 10.078125 -10.078125h-1.40625ZM11.25 2.578125c4.7893125 0 8.671875 3.882534375 8.671875 8.671875h1.40625c0 -5.56599375 -4.51209375 -10.078125 -10.078125 -10.078125v1.40625Zm0 -1.40625C5.68400625 1.171875 1.171875 5.68400625 1.171875 11.25h1.40625c0 -4.7893406249999995 3.882534375 -8.671875 8.671875 -8.671875v-1.40625Zm0 10.78125h0.08596875000000001v-1.40625H11.25v1.40625Zm-0.5549999999999999 -1.13484375 -0.40340625 0.51871875 1.1099999999999999 0.8633437500000001 0.40340625 -0.518625 -1.1099999999999999 -0.8634375000000001Zm-0.09403125 -9.2137125 -0.6429374999999999 1.542984375 1.2980625000000001 0.540871875 0.6429374999999999 -1.5429937500000002 -1.2980625000000001 -0.5408625ZM16.3546875 12.65203125l-0.273 0.300375 1.0405312500000001 0.9459374999999999 0.27309375 -0.300375 -1.0406250000000001 -0.9459374999999999Zm3.0590625 -2.08771875 0.6985312499999999 0.7100624999999999 1.00246875 -0.9862500000000001 -0.6985312499999999 -0.7099687499999999 -1.00246875 0.9861562500000001Zm-3.3320624999999997 2.38809375c-2.6906250000000003 2.9596875000000002 -6.7433812500000005 4.90021875 -10.70728125 4.90021875v1.40625c4.395375 0 8.815312500000001 -2.13478125 11.7478125 -5.36053125l-1.0405312500000001 -0.9459374999999999ZM9.95803125 3.147553125c-1.154540625 2.7709593750000003 -0.895265625 5.929528125 0.6957187499999999 8.475103125l1.1925000000000001 -0.7453125c-1.34953125 -2.159259375 -1.56946875 -4.838484375 -0.5901562499999999 -7.18891875l-1.2980625000000001 -0.540871875Zm0.3335625 8.189446875C8.608996875 13.50028125 6.02188125 14.765625 3.28125 14.765625v1.40625c3.1745812499999997 0 6.171374999999999 -1.4656874999999998 8.12034375 -3.97153125l-1.1099999999999999 -0.8633437500000001ZM6.382209375 2.605153125c-1.5721125 3.7730812499999997 -1.5721125 7.954659375 0 11.727815625l1.29808125 -0.5409375c-1.4278875 -3.42684375 -1.4278875 -7.2190875 0 -10.646015625l-1.29808125 -0.5408625ZM10.3125 6.796875c3.4151249999999997 0 6.690375 1.3566562500000001 9.10528125 3.7715625l0.9944062499999999 -0.9944062499999999C17.7335625 6.895443749999999 14.100562499999999 5.390625 10.3125 5.390625v1.40625Zm1.02346875 5.15625c2.9325 0 5.67103125 1.46559375 7.29778125 3.9056250000000006l1.17 -0.7799999999999999c-1.88746875 -2.83125 -5.0650312500000005 -4.531874999999999 -8.46778125 -4.531874999999999v1.40625Z" fill="black" />
          </svg>
          <p className="text-sm font-medium text-sky-800">
            {peNames.map((n) => n.split(' ')[0]).join(' & ')} - {regionConfig.pe.kit}
          </p>
        </div>
      )}

      {/* Term type labels — consolidated when all schools share the same event */}
      {termSchools && termSchools.length > 0 && (() => {
        // Group by event type (holiday / inset)
        const byType = {}
        for (const s of termSchools) {
          if (!byType[s.type]) byType[s.type] = []
          byType[s.type].push(s)
        }
        return Object.entries(byType).flatMap(([type, schools]) => {
          const label = type === 'inset' ? regionConfig.termLabels.insetDay : regionConfig.termLabels.schoolHoliday
          const allClosed = totalSchoolCount > 0 && schools.length === totalSchoolCount
          if (allClosed) {
            const suffix = totalSchoolCount === 1
              ? shortSchoolName(schools[0].schoolName)
              : totalSchoolCount === 2 ? 'Both schools' : 'All schools'
            return [(
              <div key={type} className="mt-2 border rounded-xl px-3 py-2 text-sm font-medium text-canopy-deep bg-canopy-frost border-canopy-mist">
                {label}{suffix ? ` · ${suffix}` : ''}
              </div>
            )]
          }
          return schools.map((s, i) => {
            const color = SCHOOL_COLORS[s.schoolIndex] ?? SCHOOL_COLORS[0]
            return (
              <div key={`${type}-${i}`} className={`mt-2 border rounded-xl px-3 py-2 text-sm font-medium ${color}`}>
                {label}{shortSchoolName(s.schoolName) ? ` · ${shortSchoolName(s.schoolName)}` : ''}
              </div>
            )
          })
        })
      })()}

      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {type === 'change_pending'  && <Badge label="Change requested"  type="change_pending" />}
        {type === 'change_accepted' && <Badge label="Schedule changed"  type="change_accepted" />}
        {type === 'change_declined' && <Badge label="Change declined"   type="change_declined" />}
        {type === 'offered'         && <Badge label="FROR offered"      type="offered" />}
        {type === 'offer_accepted'  && <Badge label="FROR accepted"     type="offer_accepted" />}
        {type === 'offer_declined'  && <Badge label="FROR declined"     type="offer_declined" />}
        {morningEligible && (
          morningNeeded
            ? <Badge label={`${parentA?.display_name ?? 'Parent A'} needs morning cover`} type="morning_needed" />
            : <Badge label="Morning cover not needed" type="morning_excluded" />
        )}
      </div>

      {/* Morning coverage veto — only for the day the auto-rule actually
          flagged (kids with Parent A overnight, before a school morning).
          Only Parent A (the one it's actually about) can veto it; Parent B
          and any carer with calendar access can still see the badge above. */}
      {morningEligible && userRole === 'parent_a' && (
        <button
          onClick={toggleMorningException}
          disabled={savingMorning}
          className="mt-2 text-xs text-canopy-mid underline disabled:opacity-50"
        >
          {savingMorning ? 'Saving…' : morningNeeded ? "Mark as not needed" : "Mark as needed after all"}
        </button>
      )}

      {/* Changeover info */}
      {isTransition && (
        <div className="mt-2 bg-white/60 rounded-xl px-3 py-2">
          {!editingChangeover ? (
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-700">
                  Handover {changeoverTime ? `at ${changeoverTime}` : '— no time set'}
                </p>
                {changeoverLocation && <p className="text-xs text-gray-500">{changeoverLocation}</p>}
              </div>
              {isParent && (
                <button
                  className="text-xs text-canopy-mid font-medium hover:underline shrink-0"
                  onClick={() => {
                    setDraftTime(changeoverTime ?? '')
                    setDraftLocation(changeoverLocation ?? '')
                    setEditingChangeover(true)
                  }}
                >
                  Edit
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Time</label>
                  <input
                    type="time"
                    value={draftTime}
                    onChange={(e) => setDraftTime(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Location</label>
                  <input
                    type="text"
                    value={draftLocation}
                    onChange={(e) => setDraftLocation(e.target.value)}
                    placeholder="e.g. School"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 text-xs py-1.5"
                  loading={savingChangeover}
                  onClick={async () => {
                    setSavingChangeover(true)
                    const overrides = { ...(family?.config?.changeover_overrides ?? {}) }
                    overrides[dateStr] = { time: draftTime || null, location: draftLocation.trim() || null }
                    await updateFamilyConfig({ changeover_overrides: overrides })
                    setSavingChangeover(false)
                    setEditingChangeover(false)
                  }}
                >
                  Save
                </Button>
                <Button variant="secondary" className="text-xs py-1.5" onClick={() => setEditingChangeover(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(change?.start_time || change?.end_time) && (
        <p className="text-xs text-gray-600 mt-2 bg-white/60 rounded-lg px-3 py-2">
          <span className="font-semibold">Time: </span>
          {change.start_time ?? '—'} → {change.end_time ?? '—'}
        </p>
      )}
      {change?.note && (
        <p className="text-xs text-gray-600 mt-2 bg-white/60 rounded-lg px-3 py-2">
          <span className="font-semibold">Note: </span>{change.note}
        </p>
      )}

      {/* Family events for this day */}
      {dayEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {dayEvents.map((ev) => (
            <div key={ev.id} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  {ev.event_time && (
                    <p className="text-xs text-gray-600">
                      {ev.event_time}{ev.end_time ? ` – ${ev.end_time}` : ''}
                      {ev.recurrence && <span className="ml-1.5 text-gray-400">↻ {ev.recurrence}</span>}
                    </p>
                  )}
                  {ev.notes && (
                    <p className="text-xs text-gray-600 mt-0.5">{ev.notes}</p>
                  )}
                  {ev.source === 'email_ai' && ev.source_subject && (
                    <p className="text-[10px] text-gray-400 mt-0.5">From email: "{ev.source_subject}"</p>
                  )}
                  {ev.tagged_children?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ev.tagged_children.map((name) => (
                        <span key={name} className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                          {firstName(name)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {isParent && (
                  <button
                    onClick={() => setEditingEvent(ev)}
                    className="shrink-0 p-1 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                    aria-label="Edit event"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Primary actions */}
      {isParent && (
        <div className="flex gap-2 mt-3 flex-wrap">
          <Button variant="secondary" className="text-xs py-2" onClick={() => onRequestChange(day)}>
            Request change
          </Button>
          {isMyDay && type === 'baseline' && (
            <Button variant="secondary" className="text-xs py-2" onClick={() => onOfferFROR(day)}>
              Offer FROR
            </Button>
          )}
        </div>
      )}

      {/* Respond to pending change (shown to the other parent) */}
      {change && type === 'change_pending' && isParent && (
        <RespondToChange change={change} />
      )}

      {/* FROR offer details */}
      {offer && (type === 'offered' || type === 'offer_accepted') && (
        <div className="mt-2 bg-white/60 rounded-xl px-3 py-2 space-y-1">
          {(offer.start_time || offer.end_time) && (
            <p className="text-xs text-gray-700">
              <span className="font-semibold">Time: </span>
              {offer.start_time ?? '—'} – {offer.end_time ?? '—'}
            </p>
          )}
          {offer.note && (
            <p className="text-xs text-gray-600">
              <span className="font-semibold">Note: </span>{offer.note}
            </p>
          )}
        </div>
      )}

      {/* Respond to FROR offer (shown to the receiving parent) */}
      {offer && type === 'offered' && isParent && userRole !== offer.offered_by_role && (
        <RespondToOffer offer={offer} />
      )}

      <EditEventSheet
        event={editingEvent}
        open={!!editingEvent}
        onClose={() => setEditingEvent(null)}
        onRefetch={onRefetchEvents}
      />
    </div>
  )
}

function RespondToChange({ change }) {
  const { user } = useAuth()
  if (change.requested_by === user?.id) return null

  async function respond(status) {
    await supabase
      .from('schedule_changes')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', change.id)
  }

  return (
    <div className="flex gap-2 mt-2">
      <Button className="text-xs py-2 flex-1 bg-green-600 hover:bg-green-700" onClick={() => respond('accepted')}>
        Accept
      </Button>
      <Button variant="secondary" className="text-xs py-2 flex-1 text-red-600" onClick={() => respond('declined')}>
        Decline
      </Button>
    </div>
  )
}

function RespondToOffer({ offer }) {
  async function respond(status) {
    await supabase
      .from('fror_offers')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', offer.id)
  }

  return (
    <div className="flex gap-2 mt-2">
      <Button className="text-xs py-2 flex-1 bg-green-600 hover:bg-green-700" onClick={() => respond('accepted')}>
        Accept FROR
      </Button>
      <Button variant="secondary" className="text-xs py-2 flex-1 text-red-600" onClick={() => respond('declined')}>
        Decline
      </Button>
    </div>
  )
}
