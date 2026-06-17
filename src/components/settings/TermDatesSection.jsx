import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import Button from '../ui/Button'

const HOLIDAY_TITLES = [
  'Summer Holiday',
  'Christmas Holiday',
  'Easter Holiday',
  'Autumn Half Term',
  'Spring Half Term',
  'Summer Half Term',
]

function classify(ev) {
  if (ev.title.toLowerCase().includes('inset')) return 'inset'
  if (ev.end_date) return 'holiday'
  return 'other'
}

export default function TermDatesSection() {
  const { family, isParent } = useFamily()
  const [events, setEvents]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [showAdd, setShowAdd]       = useState(false)
  const [addType, setAddType]       = useState('holiday')
  const [addTitle, setAddTitle]     = useState(HOLIDAY_TITLES[0])
  const [addCustom, setAddCustom]   = useState('')
  const [addDate, setAddDate]       = useState('')
  const [addEnd, setAddEnd]         = useState('')
  const [addSaving, setAddSaving]   = useState(false)
  const [addError, setAddError]     = useState(null)
  const [fetching, setFetching]     = useState(false)
  const [fetchMsg, setFetchMsg]     = useState(null)
  const [imgUploading, setImgUploading] = useState(false)
  const [imgMsg, setImgMsg]         = useState(null)
  const fileRef                     = useRef(null)

  const thisYear = new Date().getFullYear()

  async function load() {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('family_events')
      .select('id, title, event_date, end_date')
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
      .gte('event_date', `${thisYear - 1}-01-01`)
      .order('event_date')
    setEvents(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [family?.id])

  async function remove(id) {
    await supabase.from('family_events').delete().eq('id', id)
    setEvents((p) => p.filter((e) => e.id !== id))
  }

  async function add() {
    const title = addTitle === 'Other' ? addCustom.trim() : addTitle
    if (!title || !addDate) { setAddError('Enter a title and date.'); return }
    if (addType === 'holiday' && !addEnd) { setAddError('Enter an end date.'); return }
    if (addType === 'holiday' && addEnd < addDate) { setAddError('End date must be after start date.'); return }
    setAddSaving(true)
    setAddError(null)
    const { error } = await supabase.rpc('create_family_event', {
      p_family_id:      family.id,
      p_title:          title,
      p_event_date:     addDate,
      p_end_date:       addType === 'holiday' ? addEnd : null,
      p_source:         'term_dates',
      p_source_subject: 'School term dates',
    })
    setAddSaving(false)
    if (error) { setAddError(error.message); return }
    setShowAdd(false)
    setAddDate('')
    setAddEnd('')
    setAddTitle(HOLIDAY_TITLES[0])
    setAddCustom('')
    load()
  }

  async function fetchFromSchool() {
    setFetching(true)
    setFetchMsg(null)
    const { data: res, error } = await supabase.functions.invoke('check-term-dates', { body: {} })
    setFetching(false)
    if (error) { setFetchMsg({ type: 'error', msg: 'Could not connect.' }); return }
    const results = res?.results ?? []
    if (!results.length) { setFetchMsg({ type: 'error', msg: 'No school URL saved in Info Bank.' }); return }
    const pri = { ok: 4, unchanged: 3, no_dates: 2, error: 1 }
    const r = results.reduce((b, c) => (pri[c.status] ?? 0) > (pri[b.status] ?? 0) ? c : b, results[0])
    if (r.status === 'error') {
      setFetchMsg({ type: 'error', msg: r.error ?? 'Something went wrong.' })
    } else if (r.eventsAdded > 0) {
      setFetchMsg({ type: 'success', msg: `${r.eventsAdded} term date${r.eventsAdded === 1 ? '' : 's'} added.` })
      load()
    } else {
      setFetchMsg({ type: 'info', msg: 'Calendar already up to date.' })
    }
  }

  async function uploadImage(file) {
    setImgUploading(true)
    setImgMsg(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1]
      const { data: res, error } = await supabase.functions.invoke('extract-school-info', {
        body: { family_id: family?.id, image_base64: base64, image_media_type: file.type },
      })
      setImgUploading(false)
      if (error || !res) { setImgMsg({ type: 'error', msg: 'Could not read image.' }); return }
      if (res.error)     { setImgMsg({ type: 'error', msg: res.error }); return }
      const added = res.events_added ?? 0
      setImgMsg({
        type: added > 0 ? 'success' : 'info',
        msg:  added > 0 ? `${added} term date${added === 1 ? '' : 's'} added.` : 'No new term dates found in image.',
      })
      if (added > 0) load()
    }
    reader.readAsDataURL(file)
  }

  const msgClass = (type) =>
    type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-600' : 'text-gray-500'

  if (loading) return <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Auto-fetch buttons */}
      {isParent && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={fetchFromSchool}
              disabled={fetching}
              className="flex-1 border border-canopy-mist bg-canopy-frost text-canopy-deep rounded-xl py-2.5 text-sm font-medium hover:bg-canopy-mist transition-colors disabled:opacity-50"
            >
              {fetching ? 'Checking…' : 'Fetch from school website'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={imgUploading}
              className="flex-1 border border-gray-200 bg-white text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {imgUploading ? 'Reading…' : 'Upload screenshot'}
            </button>
          </div>
          {fetchMsg && <p className={`text-xs font-medium ${msgClass(fetchMsg.type)}`}>{fetchMsg.msg}</p>}
          {imgMsg   && <p className={`text-xs font-medium ${msgClass(imgMsg.type)}`}>{imgMsg.msg}</p>}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { if (e.target.files[0]) uploadImage(e.target.files[0]); e.target.value = '' }} />
        </div>
      )}

      {/* Event list */}
      {events.length === 0 ? (
        <p className="text-sm text-gray-400">No term dates added yet.</p>
      ) : (
        <div className="space-y-1.5">
          {events.map((ev) => {
            const type = classify(ev)
            return (
              <div key={ev.id} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${type === 'inset' ? 'bg-amber-400' : 'bg-purple-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-400">
                    {format(parseISO(ev.event_date), 'd MMM yyyy')}
                    {ev.end_date && ` – ${format(parseISO(ev.end_date), 'd MMM yyyy')}`}
                  </p>
                </div>
                {isParent && (
                  <button onClick={() => remove(ev.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">
                    Remove
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Manual add */}
      {isParent && (
        showAdd ? (
          <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50">
            {/* Type toggle */}
            <div className="flex gap-2">
              {[['holiday', 'School Holiday'], ['inset', 'INSET Day']].map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setAddType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    addType === t ? 'border-canopy-mid bg-canopy-frost text-canopy-deep' : 'border-gray-200 bg-white text-gray-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Title (holidays only) */}
            {addType === 'holiday' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Title</label>
                <select
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                >
                  {HOLIDAY_TITLES.map((t) => <option key={t}>{t}</option>)}
                  <option value="Other">Other…</option>
                </select>
                {addTitle === 'Other' && (
                  <input
                    type="text"
                    value={addCustom}
                    onChange={(e) => setAddCustom(e.target.value)}
                    placeholder="Holiday name"
                    className="w-full mt-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                )}
              </div>
            )}

            {/* Dates */}
            <div className={addType === 'holiday' ? 'grid grid-cols-2 gap-2' : ''}>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  {addType === 'holiday' ? 'Start date' : 'Date'}
                </label>
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                />
              </div>
              {addType === 'holiday' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End date</label>
                  <input
                    type="date"
                    value={addEnd}
                    min={addDate}
                    onChange={(e) => setAddEnd(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                </div>
              )}
            </div>

            {addError && <p className="text-xs text-red-600">{addError}</p>}

            <div className="flex gap-2">
              <Button className="flex-1 py-2.5 text-sm" loading={addSaving} onClick={add}>Add</Button>
              <Button variant="secondary" className="text-sm py-2.5" onClick={() => { setShowAdd(false); setAddError(null) }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
          >
            + Add dates manually
          </button>
        )
      )}
    </div>
  )
}
