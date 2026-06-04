import { useState } from 'react'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { formatDate } from '../../lib/scheduleEngine'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

export default function NewEventSheet({ open, onClose, initialDate }) {
  const { family, member, userRole, parentA, parentB } = useFamily()

  const [title, setTitle]       = useState('')
  const [date, setDate]         = useState(initialDate ?? formatDate(new Date()))
  const [endDate, setEndDate]   = useState('')
  const [time, setTime]         = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  const recipientRole  = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
  const recipientMember = recipientRole === 'parent_a' ? parentA : parentB

  async function submit() {
    if (!title.trim()) { setError('Add a title.'); return }
    if (!date)         { setError('Pick a date.'); return }
    setSaving(true)
    setError(null)

    const { error: dbErr } = await supabase.rpc('create_family_event', {
      p_family_id:  family.id,
      p_title:      title.trim(),
      p_event_date: date,
      p_end_date:   endDate || null,
      p_event_time: time || null,
      p_notes:      notes.trim() || null,
      p_source:     'manual',
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    // Post a notice so the other parent is notified
    const timeStr = time ? ` at ${time}` : ''
    const rangeStr = endDate && endDate !== date ? ` – ${endDate}` : ''
    const notesStr = notes.trim() ? `\n${notes.trim()}` : ''

    const { error: noticeErr } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   `📅 ${member?.display_name ?? 'A parent'} added an event: ${title.trim()}\n${date}${rangeStr}${timeStr}${notesStr}`,
      p_image_url: null,
      p_file_url:  null,
      p_file_name: null,
      p_tag:       'notification',
    })
    if (noticeErr) console.error('Notice post error:', noticeErr)

    if (recipientMember) {
      await sendPushNotification({
        familyId:     family.id,
        recipientRole,
        title:        'New calendar event',
        body:         `${title.trim()} — ${date}${timeStr}`,
        url:          '/calendar',
      })
    }

    handleClose()
  }

  function handleClose() {
    setTitle('')
    setDate(initialDate ?? formatDate(new Date()))
    setEndDate('')
    setTime('')
    setNotes('')
    setError(null)
    setSaving(false)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="New event">
      <div className="px-5 py-4 space-y-4">

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. School sports day"
            autoFocus
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">End date <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Time <span className="font-normal text-gray-400">(optional)</span></label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full py-3" loading={saving} disabled={!title.trim()} onClick={submit}>
          Add event
        </Button>
      </div>
    </BottomSheet>
  )
}
