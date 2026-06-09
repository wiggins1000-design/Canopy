import { useState, useEffect } from 'react'
import { format, differenceInDays } from 'date-fns'
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
  const [courtFlags, setCourtFlags] = useState([])
  const [activeOrder, setActiveOrder] = useState(null)

  // Load active court order for advisory checks
  useEffect(() => {
    if (!family?.id) return
    supabase
      .from('court_orders')
      .select('raw_rules')
      .eq('family_id', family.id)
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data }) => setActiveOrder(data?.raw_rules ?? null))
  }, [family?.id])

  // Re-run advisory checks whenever dates, holiday flag, or order change
  useEffect(() => {
    if (!activeOrder || !startDay) { setCourtFlags([]); return }
    setCourtFlags(checkCourtOrder(activeOrder, formatDate(startDay.date), endDateStr, isHoliday))
  }, [activeOrder, startDay, endDateStr, isHoliday])

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

        {/* Court order advisory flags */}
        {courtFlags.length > 0 && (
          <div className="space-y-1.5">
            {courtFlags.map((flag, i) => (
              <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <span className="text-amber-500 text-sm shrink-0">⚠️</span>
                <p className="text-xs text-amber-700 leading-relaxed">{flag}</p>
              </div>
            ))}
            <p className="text-xs text-gray-400">Advisory only — not legal advice.</p>
          </div>
        )}

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

function checkCourtOrder(rules, startDate, endDate, isHoliday) {
  const flags = []
  if (!rules || !startDate) return flags

  const today     = new Date()
  const start     = new Date(startDate)
  const daysNotice = differenceInDays(start, today)

  // Notice period check
  if (isHoliday && rules.notice_requirements?.holiday_request_days) {
    const required = rules.notice_requirements.holiday_request_days
    if (daysNotice < required) {
      flags.push(`Your court order requires ${required} days' notice for holiday requests. This request is only ${daysNotice} day${daysNotice !== 1 ? 's' : ''} ahead.`)
    }
  } else if (!isHoliday && rules.notice_requirements?.schedule_change_hours) {
    const required = rules.notice_requirements.schedule_change_hours
    const hoursNotice = daysNotice * 24
    if (hoursNotice < required) {
      flags.push(`Your court order requires ${required} hours' notice for schedule changes. This request is only ~${Math.round(hoursNotice)}h ahead.`)
    }
  }

  // Holiday duration check
  if (isHoliday && endDate && rules.holiday_entitlements?.length > 0) {
    const duration = differenceInDays(new Date(endDate), start) + 1
    const startMonth = start.getMonth()
    let period = 'other'
    if (startMonth >= 6 && startMonth <= 8) period = 'summer'
    else if (startMonth === 11 || startMonth === 0) period = 'christmas'
    else if (startMonth === 2 || startMonth === 3) period = 'easter'

    const entitlement = rules.holiday_entitlements.find(h =>
      h.period?.toLowerCase().includes(period) || h.period?.toLowerCase().includes('half')
    )
    if (entitlement) {
      const myDays = rules.residence?.primary_parent === 'parent_a' ? entitlement.parent_b_days : entitlement.parent_a_days
      if (myDays != null && duration > myDays) {
        flags.push(`Your court order entitles you to ${myDays} days for this period. This request covers ${duration} days.`)
      }
    }
  }

  // Geographic flag
  if (rules.geographic_restrictions) {
    flags.push(`Reminder: ${rules.geographic_restrictions}`)
  }

  return flags
}
