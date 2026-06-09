import { useState, useRef } from 'react'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/scheduleEngine'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON   = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export default function NewEventSheet({ open, onClose, initialDate }) {
  const { family, member, userRole, parentA, parentB } = useFamily()
  const { user } = useAuth()

  const [title, setTitle]     = useState('')
  const [date, setDate]       = useState(initialDate ?? formatDate(new Date()))
  const [endDate, setEndDate] = useState('')
  const [time, setTime]       = useState('')
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Photo capture
  const [extracting, setExtracting]     = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)

  // Voice capture
  const [recording, setRecording]       = useState(false)
  const [transcript, setTranscript]     = useState('')
  const recognitionRef = useRef(null)

  const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
  const recipientMember = recipientRole === 'parent_a' ? parentA : parentB

  // ── Photo capture ─────────────────────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result
      setImagePreview(dataUrl)
      await extractFromImage(dataUrl, file.type)
    }
    reader.readAsDataURL(file)
  }

  async function extractFromImage(dataUrl, mimeType) {
    setExtracting(true)
    setError(null)
    try {
      const base64 = dataUrl.split(',')[1]
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-event-from-image`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        SUPABASE_ANON,
        },
        body: JSON.stringify({ type: 'image', image_base64: base64, media_type: mimeType }),
      })
      const json = await res.json()
      if (json.ok && json.event) {
        applyExtracted(json.event)
      } else {
        setError('Could not extract event details from that image.')
      }
    } catch (e) {
      setError('Image extraction failed — please fill in the details manually.')
    }
    setExtracting(false)
  }

  // ── Voice capture ─────────────────────────────────────────────────────────

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop()
      setRecording(false)
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Try Chrome.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang           = 'en-GB'
    recognition.continuous     = false
    recognition.interimResults = false

    recognition.onresult = async (e) => {
      const text = e.results[0][0].transcript
      setTranscript(text)
      setRecording(false)
      await extractFromVoice(text)
    }
    recognition.onerror = () => {
      setError('Could not hear anything — please try again.')
      setRecording(false)
    }
    recognition.onend = () => setRecording(false)

    recognition.start()
    recognitionRef.current = recognition
    setRecording(true)
    setTranscript('')
    setError(null)
  }

  async function extractFromVoice(text) {
    setExtracting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-event-from-image`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        SUPABASE_ANON,
        },
        body: JSON.stringify({ type: 'voice', transcript: text }),
      })
      const json = await res.json()
      if (json.ok && json.event) {
        applyExtracted(json.event)
      } else {
        setError('Could not parse the event from what you said — please fill in the details manually.')
      }
    } catch {
      setError('Voice parsing failed — please fill in the details manually.')
    }
    setExtracting(false)
  }

  function applyExtracted(ev) {
    if (ev.title) setTitle(ev.title)
    if (ev.date)  setDate(ev.date)
    if (ev.end_date) setEndDate(ev.end_date)
    if (ev.time)  setTime(ev.time)
    if (ev.notes) setNotes(ev.notes)
  }

  // ── Submit ────────────────────────────────────────────────────────────────

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

    const timeStr  = time ? ` at ${time}` : ''
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
    setImagePreview(null)
    setTranscript('')
    setExtracting(false)
    setRecording(false)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="New event">
      <div className="px-5 py-4 space-y-4">

        {/* Quick-add buttons */}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting}
            className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
          >
            <CameraIcon className="w-4 h-4" />
            Photo / screenshot
          </button>
          <button
            type="button"
            onClick={toggleRecording}
            disabled={extracting}
            className={`flex-1 flex items-center justify-center gap-2 border-2 rounded-xl py-3 text-sm font-medium transition-colors disabled:opacity-50 ${
              recording
                ? 'border-red-400 bg-red-50 text-red-600 animate-pulse'
                : 'border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            <MicIcon className="w-4 h-4" />
            {recording ? 'Listening…' : 'Voice note'}
          </button>
        </div>

        {/* Extraction states */}
        {extracting && (
          <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-xl px-3 py-2.5">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
            Extracting event details…
          </div>
        )}
        {transcript && !extracting && (
          <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600 italic">
            "{transcript}"
          </div>
        )}
        {imagePreview && !extracting && (
          <div className="relative">
            <img src={imagePreview} alt="Captured" className="w-full max-h-40 object-contain rounded-xl bg-gray-100" />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute top-1 right-1 bg-white rounded-full p-1 shadow text-gray-500"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Form fields */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. School sports day"
            autoFocus={!imagePreview && !transcript}
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
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              End date <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            Time <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            Notes <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full py-3" loading={saving} disabled={!title.trim() || extracting} onClick={submit}>
          Add event
        </Button>
      </div>
    </BottomSheet>
  )
}

function CameraIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <circle cx="12" cy="13" r="3" strokeLinecap="round" />
    </svg>
  )
}

function MicIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  )
}

function XIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
