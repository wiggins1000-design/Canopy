import { useState, useRef } from 'react'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { supabase, sendPushNotification, isNativePlatform } from '../../lib/supabase'
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

  const children = (family?.config?.children ?? []).filter((c) => c.name)
  // Correctly-spelled names to bias transcription/OCR corrections toward —
  // e.g. voice input mishearing "Isabelle" as something similar-sounding.
  const knownNames = [...new Set([
    ...children.map(c => c.name),
    parentA?.display_name,
    parentB?.display_name,
  ].filter(Boolean))]

  const [title, setTitle]                   = useState('')
  const [date, setDate]                     = useState(initialDate ?? formatDate(new Date()))
  const [endDate, setEndDate]               = useState('')
  const [time, setTime]                     = useState('')
  const [endTime, setEndTime]               = useState('')
  const [recurrence, setRecurrence]         = useState('')
  const [recurrenceEnd, setRecurrenceEnd]   = useState('')
  const [notes, setNotes]                   = useState('')
  const [taggedChildren, setTaggedChildren] = useState([])
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState(null)

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
        body: JSON.stringify({ type: 'image', image_base64: base64, media_type: mimeType, known_names: knownNames }),
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

  async function toggleRecording() {
    if (recording) {
      if (isNativePlatform()) await SpeechRecognition.stop()
      else recognitionRef.current?.stop()
      setRecording(false)
      return
    }

    if (isNativePlatform()) {
      await toggleNativeRecording()
      return
    }

    const SpeechRecognitionWeb = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionWeb) {
      setError('Voice input is not supported in this browser. Try Chrome.')
      return
    }

    const recognition = new SpeechRecognitionWeb()
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

  // Native iOS/Android path — Web Speech API doesn't exist in Capacitor's WKWebView on iOS.
  async function toggleNativeRecording() {
    setError(null)
    try {
      console.log('[voice] checking availability…')
      const { available } = await SpeechRecognition.available()
      console.log('[voice] available:', available)
      if (!available) {
        setError('Voice input is not available on this device.')
        return
      }
      console.log('[voice] requesting permissions…')
      const perms = await SpeechRecognition.requestPermissions()
      console.log('[voice] permissions result:', JSON.stringify(perms))
      if (perms.speechRecognition !== 'granted') {
        setError('Microphone access is needed for voice input — check Settings.')
        return
      }

      setRecording(true)
      setTranscript('')
      console.log('[voice] starting recognition…')
      const result = await SpeechRecognition.start({ language: 'en-GB', partialResults: false, popup: false })
      console.log('[voice] result:', JSON.stringify(result))
      setRecording(false)

      const text = result?.matches?.[0]
      if (text) {
        setTranscript(text)
        await extractFromVoice(text)
      } else {
        setError('Could not hear anything — please try again.')
      }
    } catch (e) {
      // TEMP diagnostic: surface the real failure instead of a generic message while we
      // track down why no permission prompt appears. Revert to a plain message once fixed.
      console.error('[voice] native path threw:', e)
      setRecording(false)
      setError(`Voice failed: ${e?.message ?? e?.code ?? JSON.stringify(e) ?? 'unknown error'}`)
    }
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
        body: JSON.stringify({ type: 'voice', transcript: text, known_names: knownNames }),
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
    if (ev.end_time) setEndTime(ev.end_time)
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
      p_family_id:        family.id,
      p_title:            title.trim(),
      p_event_date:       date,
      p_end_date:         endDate || null,
      p_event_time:       time || null,
      p_end_time:         endTime || null,
      p_notes:            notes.trim() || null,
      p_source:           'manual',
      p_recurrence:       recurrence || null,
      p_recurrence_end:   recurrenceEnd || null,
      p_tagged_children:  taggedChildren.length > 0 ? taggedChildren : null,
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
    setEndTime('')
    setRecurrence('')
    setRecurrenceEnd('')
    setNotes('')
    setTaggedChildren([])
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
            className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm font-medium text-gray-600 hover:border-canopy-green hover:text-canopy-mid transition-colors disabled:opacity-50"
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
                : 'border-dashed border-gray-300 text-gray-600 hover:border-canopy-green hover:text-canopy-mid'
            }`}
          >
            <MicIcon className="w-4 h-4" />
            {recording ? 'Listening…' : 'Voice note'}
          </button>
        </div>

        {/* Extraction states */}
        {extracting && (
          <div className="flex items-center gap-2 text-sm text-canopy-mid bg-canopy-frost rounded-xl px-3 py-2.5">
            <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin shrink-0" />
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
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              End date <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              Start time <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="time"
              value={time}
              onChange={(e) => { setTime(e.target.value); if (!e.target.value) setEndTime('') }}
              className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
              End time <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={!time}
              className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green disabled:bg-gray-50 disabled:text-gray-400"
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

        {children.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
              For <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {children.map((c) => {
                const selected = taggedChildren.includes(c.name)
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setTaggedChildren((prev) =>
                      selected ? prev.filter((n) => n !== c.name) : [...prev, c.name]
                    )}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      selected
                        ? 'bg-canopy-mid text-white border-canopy-mid'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-canopy-green'
                    }`}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            Notes <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green"
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
