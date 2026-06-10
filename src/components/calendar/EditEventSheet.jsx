import { useState, useEffect } from 'react'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

export default function EditEventSheet({ event, open, onClose, onRefetch }) {
  const { family, member, userRole, parentA, parentB } = useFamily()
  const [title, setTitle]             = useState('')
  const [date, setDate]               = useState('')
  const [endDate, setEndDate]         = useState('')
  const [time, setTime]               = useState('')
  const [endTime, setEndTime]         = useState('')
  const [recurrence, setRecurrence]   = useState('')
  const [recurrenceEnd, setRecurrenceEnd] = useState('')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    if (event) {
      setTitle(event.title ?? '')
      setDate(event.event_date ?? '')
      setEndDate(event.end_date ?? '')
      setTime(event.event_time ?? '')
      setEndTime(event.end_time ?? '')
      setRecurrence(event.recurrence ?? '')
      setRecurrenceEnd(event.recurrence_end ?? '')
      setNotes(event.notes ?? '')
      setConfirmDelete(false)
      setError(null)
    }
  }, [event])

  async function save() {
    if (!title.trim()) { setError('Add a title.'); return }
    if (!date)         { setError('Pick a date.'); return }
    setSaving(true)
    setError(null)
    // Use the original event_date for recurring events (don't update to the expanded instance date)
    const canonicalDate = event.recurrence ? (event._original_date ?? date) : date
    const { error: err } = await supabase
      .from('family_events')
      .update({
        title:          title.trim(),
        event_date:     canonicalDate,
        end_date:       endDate || null,
        event_time:     time || null,
        end_time:       endTime || null,
        notes:          notes.trim() || null,
        recurrence:     recurrence || null,
        recurrence_end: recurrenceEnd || null,
      })
      .eq('id', event.id)
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    onRefetch?.()
    onClose()
  }

  async function deleteEvent() {
    setDeleting(true)
    await supabase.from('family_events').delete().eq('id', event.id)

    const authorName = member?.display_name ?? 'A parent'
    const { error: noticeErr } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   `🗑 ${authorName} removed an event: ${event.title}`,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       'notification',
    })
    if (noticeErr) console.error('Delete notice post error:', noticeErr)

    const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
    const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
    if (recipientMember) {
      await sendPushNotification({
        familyId:     family.id,
        recipientRole,
        title:        'Calendar event removed',
        body:         `${authorName} removed "${event.title}"`,
        url:          '/calendar',
      })
    }

    setDeleting(false)
    onRefetch?.()
    onClose()
  }

  function handleClose() {
    setConfirmDelete(false)
    setError(null)
    onClose()
  }

  if (!event) return null

  return (
    <BottomSheet open={open} onClose={handleClose} title="Edit event">
      <div className="px-5 py-4 space-y-4">

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">End date <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Start time <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="time"
              value={time}
              onChange={(e) => { setTime(e.target.value); if (!e.target.value) setEndTime('') }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">End time <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={!time}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Repeat</label>
          <div className="flex gap-1.5 flex-wrap">
            {[{ v: '', l: 'None' }, { v: 'weekly', l: 'Weekly' }, { v: 'fortnightly', l: 'Fortnightly' }, { v: 'monthly', l: 'Monthly' }, { v: 'yearly', l: 'Yearly' }].map(({ v, l }) => (
              <button
                key={v}
                type="button"
                onClick={() => { setRecurrence(v); if (!v) setRecurrenceEnd('') }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  recurrence === v
                    ? 'bg-canopy-mid text-white border-canopy-mid'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-canopy-green'
                }`}
              >{l}</button>
            ))}
          </div>
          {recurrence && (
            <div className="mt-2">
              <label className="text-xs text-gray-400 block mb-1">End repeat <span className="text-gray-300">(optional)</span></label>
              <input
                type="date"
                value={recurrenceEnd}
                onChange={(e) => setRecurrenceEnd(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full py-3" loading={saving} disabled={!title.trim()} onClick={save}>
          Save changes
        </Button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full text-sm text-red-500 py-2 hover:underline"
          >
            Delete event
          </button>
        ) : (
          <div className="flex gap-2">
            <Button
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700"
              loading={deleting}
              onClick={deleteEvent}
            >
              Confirm delete
            </Button>
            <Button variant="secondary" className="flex-1 py-2.5" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
