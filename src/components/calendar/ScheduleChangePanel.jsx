import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate, parseDate } from '../../lib/scheduleEngine'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

export default function ScheduleChangePanel({ open, onClose, startDay, endDateStr, onNeedEndDate }) {
  const { family, userRole, parentA, parentB } = useFamily()
  const { user } = useAuth()
  const [assignedTo, setAssignedTo] = useState(userRole ?? 'parent_a')
  const [startTime, setStartTime]   = useState('')
  const [endTime, setEndTime]       = useState('')
  const [note, setNote]             = useState('')
  const [isHoliday, setIsHoliday]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)
  const startDateStr    = startDay ? formatDate(startDay.date) : null
  const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
  const recipientMember = recipientRole === 'parent_a' ? parentA : parentB

  async function submit() {
    if (!startDateStr || !endDateStr) {
      setError('Please select a start and end date.')
      return
    }
    if (!note.trim()) {
      setError('A short note is required.')
      return
    }

    setSaving(true)
    setError(null)

    const { error: dbErr } = await supabase.from('schedule_changes').insert({
      family_id:    family.id,
      requested_by: user.id,
      start_date:   startDateStr,
      end_date:     endDateStr,
      start_time:   startTime || null,
      end_time:     endTime || null,
      assigned_to:  assignedTo,
      note:         note.trim(),
      status:       'pending',
      is_holiday:   isHoliday,
    })

    if (dbErr) {
      setError(dbErr.message)
      setSaving(false)
      return
    }

    if (recipientMember) {
      const prefix = isHoliday ? 'Holiday request' : 'Schedule change requested'
      await sendPushNotification({
        familyId:      family.id,
        recipientRole,
        title:         prefix,
        body:          `${startDateStr === endDateStr ? startDateStr : `${startDateStr} → ${endDateStr}`}: ${note.trim()}`,
        url:           '/calendar',
      })
    }

    setNote('')
    setIsHoliday(false)
    setSaving(false)
    onClose()
  }

  function handleClose() {
    setNote('')
    setStartTime('')
    setEndTime('')
    setIsHoliday(false)
    setError(null)
    onClose()
  }

  const otherParentName = recipientMember?.display_name ?? (recipientRole === 'parent_a' ? 'Parent A' : 'Parent B')

  return (
    <BottomSheet open={open} onClose={handleClose} title="Request schedule change">
      <div className="px-5 py-4 space-y-5">

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Start date</label>
            <div className="bg-gray-100 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-800">
              {startDay ? format(startDay.date, 'EEE d MMM') : '—'}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">End date</label>
            <button
              className="w-full text-left bg-gray-100 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-200"
              onClick={onNeedEndDate}
            >
              {endDateStr ? format(parseDate(endDateStr), 'EEE d MMM') : (
                <span className="text-canopy-mid">Tap to select →</span>
              )}
            </button>
          </div>
        </div>

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

        {/* Assigned to */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">These days go to</label>
          <div className="flex gap-2">
            {[
              { role: 'parent_a', label: parentA?.display_name ?? 'Parent A' },
              { role: 'parent_b', label: parentB?.display_name ?? 'Parent B' },
            ].map(({ role, label }) => (
              <button
                key={role}
                onClick={() => setAssignedTo(role)}
                className={[
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  assignedTo === role
                    ? role === 'parent_a'
                      ? 'border-pa-400 bg-pa-100 text-pa-900'
                      : 'border-pb-400 bg-pb-100 text-pb-900'
                    : 'border-transparent bg-gray-100 text-gray-600',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Holiday request toggle */}
        <button
          type="button"
          onClick={() => setIsHoliday((v) => !v)}
          className="flex items-center gap-3 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
        >
          <div className={`relative w-10 h-5 rounded-full transition-colors ${isHoliday ? 'bg-amber-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isHoliday ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-gray-800">Holiday request</p>
            <p className="text-xs text-gray-400">Mark these days as a holiday period</p>
          </div>
        </button>

        {/* Note */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Note (required)</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green"
            rows={3}
            placeholder={isHoliday ? 'e.g. Half-term holiday in France…' : 'Briefly explain the reason for this change…'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          className="w-full py-3"
          loading={saving}
          disabled={!startDateStr || !endDateStr || !note.trim()}
          onClick={submit}
        >
          {isHoliday ? `Send holiday request to ${otherParentName}` : `Send request to ${otherParentName}`}
        </Button>
      </div>
    </BottomSheet>
  )
}
