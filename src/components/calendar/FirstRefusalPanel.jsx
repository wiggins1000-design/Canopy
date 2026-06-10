import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/scheduleEngine'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import Badge from '../ui/Badge'

/**
 * First Right of Refusal offer panel.
 *
 * Props:
 *   open            – boolean
 *   onClose         – () => void
 *   initialDay      – day object from useCalendar (first offered day pre-selected)
 *   calendarDays    – full month day array from useCalendar (so user can add more days)
 *   onAddDay        – (dateStr) => void — called when user taps a day on the calendar
 *   selectedDates   – string[] — dateStrs selected for the offer
 *   onToggleDate    – (dateStr) => void
 */
export default function FirstRefusalPanel({ open, onClose, calendarDays, selectedDates, onToggleDate }) {
  const { family, userRole, parentA, parentB } = useFamily()
  const { user } = useAuth()
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime]     = useState('')
  const [note, setNote]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  const recipientRole = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
  const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
  const expiryHours = family?.config?.fror_expiry_hours ?? 48

  // Only show days in current month that belong to the offering parent
  const myDays = useMemo(
    () => calendarDays.filter((d) => d.current && d.owner === userRole),
    [calendarDays, userRole],
  )

  async function submit() {
    if (selectedDates.length === 0) { setError('Select at least one day to offer.'); return }
    if (!startTime)                 { setError('Enter the start time.'); return }
    if (!endTime)                   { setError('Enter the end time.'); return }
    if (endTime <= startTime)       { setError('End time must be after start time.'); return }

    setSaving(true)
    setError(null)

    const expiresAt = new Date(Date.now() + expiryHours * 3_600_000).toISOString()

    const { error: dbErr } = await supabase.from('fror_offers').insert({
      family_id:       family.id,
      offered_by:      user.id,
      offered_by_role: userRole,
      dates:           [...selectedDates].sort(),
      start_time:      startTime,
      end_time:        endTime,
      note:            note.trim() || null,
      status:          'pending',
      expires_at:      expiresAt,
    })

    if (dbErr) {
      setError(dbErr.message)
      setSaving(false)
      return
    }

    const recipientName = recipientMember?.display_name ?? 'the other parent'
    await sendPushNotification({
      familyId:      family.id,
      recipientRole,
      title:         'First Right of Refusal',
      body:          `${selectedDates.length} day${selectedDates.length > 1 ? 's' : ''} offered (${startTime}–${endTime}) — expires in ${expiryHours}h`,
      url:           '/calendar',
    })

    setNote('')
    setSaving(false)
    onClose()
  }

  function handleClose() {
    setStartTime('')
    setEndTime('')
    setNote('')
    setError(null)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="Offer First Right of Refusal" height="max-h-[90vh]">
      <div className="px-5 py-4 space-y-5">

        <p className="text-sm text-gray-500">
          Select days from your schedule this month to offer to{' '}
          <span className="font-semibold text-gray-800">
            {recipientMember?.display_name ?? (recipientRole === 'parent_a' ? 'Parent A' : 'Parent B')}
          </span>.
          They have <span className="font-semibold">{expiryHours} hours</span> to respond.
        </p>

        {/* Day picker — only my days */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Your days this month</label>
          {myDays.length === 0 ? (
            <p className="text-sm text-gray-400">No days available this month.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {myDays.map((d) => {
                const sel = selectedDates.includes(d.dateStr)
                return (
                  <button
                    key={d.dateStr}
                    onClick={() => onToggleDate(d.dateStr)}
                    className={[
                      'px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all',
                      sel
                        ? userRole === 'parent_a'
                          ? 'border-pa-400 bg-pa-100 text-pa-900'
                          : 'border-pb-400 bg-pb-100 text-pb-900'
                        : 'border-gray-200 bg-white text-gray-700',
                    ].join(' ')}
                  >
                    {format(d.date, 'EEE d')}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Selected summary */}
        {selectedDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedDates.sort().map((ds) => (
              <Badge key={ds} label={ds} type="offered" />
            ))}
          </div>
        )}

        {/* Times */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Start time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">End time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
        </div>

        {/* Optional note */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Note (optional)</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green"
            rows={2}
            placeholder="Reason for the offer…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          className="w-full py-3"
          loading={saving}
          disabled={selectedDates.length === 0}
          onClick={submit}
        >
          Offer {selectedDates.length > 0 ? `${selectedDates.length} day${selectedDates.length > 1 ? 's' : ''}` : 'days'}
        </Button>
      </div>
    </BottomSheet>
  )
}
