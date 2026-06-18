import { useState } from 'react'
import { format } from 'date-fns'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import EditEventSheet from './EditEventSheet'
import { shortSchoolName } from '../../lib/termDatesUtils'

const OWNER_COLORS = {
  parent_a: 'text-pa-700 bg-pa-50 border-pa-200',
  parent_b: 'text-pb-700 bg-pb-50 border-pb-200',
}

const SCHOOL_COLORS = [
  'text-purple-700 bg-purple-50 border-purple-200',
  'text-teal-700 bg-teal-50 border-teal-200',
  'text-orange-700 bg-orange-50 border-orange-200',
]

export default function DayDetailPanel({ day, dayEvents = [], birthdayNames = [], termSchools = null, onRequestChange, onOfferFROR, onClose, onRefetchEvents }) {
  const { userRole, parentA, parentB, isParent, updateFamilyConfig, family } = useFamily()
  const [editingChangeover, setEditingChangeover] = useState(false)
  const [draftTime, setDraftTime] = useState('')
  const [draftLocation, setDraftLocation] = useState('')
  const [savingChangeover, setSavingChangeover] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  if (!day) return null

  const { date, owner, type, change, offer, isTransition, changeoverTime, changeoverLocation, dateStr } = day
  const ownerMember = owner === 'parent_a' ? parentA : parentB
  const ownerLabel = ownerMember?.display_name ?? (owner === 'parent_a' ? 'Parent A' : owner === 'parent_b' ? 'Parent B' : '—')
  const isMyDay = userRole === owner

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
            {birthdayNames.join(' & ')}'s birthday!
          </p>
        </div>
      )}

      {/* Term type labels — one per school */}
      {termSchools?.map((s, i) => {
        const label = s.type === 'inset' ? 'INSET Day' : 'School Holiday'
        const shortName = shortSchoolName(s.schoolName)
        const color = SCHOOL_COLORS[s.schoolIndex] ?? SCHOOL_COLORS[0]
        return (
          <div key={i} className={`mt-2 border rounded-xl px-3 py-2 text-sm font-medium ${color}`}>
            {label}{shortName ? ` · ${shortName}` : ''}
          </div>
        )
      })}

      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {type === 'change_pending'  && <Badge label="Change requested"  type="change_pending" />}
        {type === 'change_accepted' && <Badge label="Schedule changed"  type="change_accepted" />}
        {type === 'change_declined' && <Badge label="Change declined"   type="change_declined" />}
        {type === 'offered'         && <Badge label="FROR offered"      type="offered" />}
        {type === 'offer_accepted'  && <Badge label="FROR accepted"     type="offer_accepted" />}
        {type === 'offer_declined'  && <Badge label="FROR declined"     type="offer_declined" />}
      </div>

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
                        <span key={name} className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-canopy-frost text-canopy-deep border border-canopy-mist">
                          {name}
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
