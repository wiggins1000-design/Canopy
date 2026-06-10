import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import Badge from '../components/ui/Badge'

const FILTERS = ['All', 'Pending', 'Accepted', 'Declined']

export default function RequestsPage() {
  const { family, members } = useFamily()
  const navigate = useNavigate()
  const [changes, setChanges]   = useState([])
  const [offers, setOffers]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('All')

  useEffect(() => {
    if (!family?.id) return
    Promise.all([
      supabase.from('schedule_changes').select('*').eq('family_id', family.id).order('created_at', { ascending: false }),
      supabase.from('fror_offers').select('*').eq('family_id', family.id).order('created_at', { ascending: false }),
    ]).then(([{ data: c }, { data: o }]) => {
      setChanges(c ?? [])
      setOffers(o ?? [])
      setLoading(false)
    })
  }, [family?.id])

  function memberName(userId) {
    return members.find((m) => m.user_id === userId)?.display_name ?? 'Unknown'
  }

  // Combine into a unified list sorted by created_at desc
  const items = [
    ...changes.map((c) => ({ ...c, _kind: 'change' })),
    ...offers.map((o) => ({ ...o, _kind: 'offer' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const filtered = items.filter((item) => {
    if (filter === 'All') return true
    if (filter === 'Pending')  return item.status === 'pending'
    if (filter === 'Accepted') return item.status === 'accepted'
    if (filter === 'Declined') return item.status === 'declined' || item.status === 'expired'
    return true
  })

  return (
    <div className="px-4 py-5 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/calendar')} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">Requests</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filter === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm font-medium">No requests yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) =>
            item._kind === 'change'
              ? <ChangeCard key={item.id} change={item} memberName={memberName} members={members} />
              : <OfferCard  key={item.id} offer={item}  memberName={memberName} />
          )}
        </div>
      )}
    </div>
  )
}

function ChangeCard({ change, memberName, members }) {
  const assignedMember = members?.find((m) => m.role === change.assigned_to)
  const requesterMember = members?.find((m) => m.user_id === change.requested_by)
  const assignedName = requesterMember && assignedMember && requesterMember.user_id === assignedMember.user_id
    ? 'themself'
    : (assignedMember?.display_name ?? change.assigned_to)
  const dateRange = change.start_date === change.end_date
    ? format(parseISO(change.start_date), 'd MMM yyyy')
    : `${format(parseISO(change.start_date), 'd MMM')} – ${format(parseISO(change.end_date), 'd MMM yyyy')}`

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Schedule change</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{dateRange}</p>
        </div>
        <StatusBadge status={change.status} />
      </div>
      <p className="text-xs text-gray-500">
        Requested by <span className="font-medium text-gray-700">{memberName(change.requested_by)}</span>
        {' · '}assign to <span className="font-medium text-gray-700">{assignedName}</span>
      </p>
      {change.note && <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{change.note}"</p>}
      {change.responded_at && (
        <p className="text-xs text-gray-400">Responded {format(parseISO(change.responded_at), 'd MMM yyyy')}</p>
      )}
    </div>
  )
}

function OfferCard({ offer, memberName }) {
  const dates = [...(offer.dates ?? [])].sort()
  const dateLabel = dates.length === 1
    ? format(parseISO(dates[0]), 'd MMM yyyy')
    : `${format(parseISO(dates[0]), 'd MMM')} +${dates.length - 1} more`

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">FROR offer</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{dateLabel}</p>
        </div>
        <StatusBadge status={offer.status} />
      </div>
      <p className="text-xs text-gray-500">
        Offered by <span className="font-medium text-gray-700">{memberName(offer.offered_by)}</span>
      </p>
      {(offer.start_time || offer.end_time) && (
        <p className="text-xs text-gray-600">
          <span className="font-medium">Time:</span> {offer.start_time ?? '—'} – {offer.end_time ?? '—'}
        </p>
      )}
      {dates.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {dates.map((d) => (
            <span key={d} className="text-xs bg-gray-100 rounded-full px-2 py-0.5 text-gray-600">
              {format(parseISO(d), 'd MMM')}
            </span>
          ))}
        </div>
      )}
      {offer.note && <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{offer.note}"</p>}
      {offer.responded_at && (
        <p className="text-xs text-gray-400">Responded {format(parseISO(offer.responded_at), 'd MMM yyyy')}</p>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending:  { label: 'Pending',  type: 'change_pending' },
    accepted: { label: 'Accepted', type: 'accepted' },
    declined: { label: 'Declined', type: 'declined' },
    expired:  { label: 'Expired',  type: 'expired' },
  }
  const { label, type } = map[status] ?? { label: status, type: 'pending' }
  return <Badge label={label} type={type} />
}
