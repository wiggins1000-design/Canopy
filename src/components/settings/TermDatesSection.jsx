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

function normaliseOrigin(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return `${u.protocol}//${u.hostname}`.toLowerCase()
  } catch { return null }
}

export default function TermDatesSection() {
  const { family, isParent } = useFamily()
  const [events, setEvents]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [openPanel, setOpenPanel] = useState(null) // 'kb' | 'photos' | 'manual'

  // Knowledge Base
  const [kbData, setKbData]           = useState(undefined) // undefined=checking, null=none, arr=found
  const [kbImporting, setKbImporting] = useState(false)
  const [kbMsg, setKbMsg]             = useState(null)

  // Photos
  const photosRef                         = useRef(null)
  const [photoFileCount, setPhotoFileCount] = useState(0)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [photoDates, setPhotoDates]       = useState(null) // null=not started, arr=review list
  const [photoSaving, setPhotoSaving]     = useState(false)
  const [photoMsg, setPhotoMsg]           = useState(null)

  // Manual
  const [addType, setAddType]   = useState('holiday')
  const [addTitle, setAddTitle] = useState(HOLIDAY_TITLES[0])
  const [addCustom, setAddCustom] = useState('')
  const [addDate, setAddDate]   = useState('')
  const [addEnd, setAddEnd]     = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState(null)

  const thisYear = new Date().getFullYear()

  async function loadEvents() {
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

  useEffect(() => { loadEvents() }, [family?.id])

  useEffect(() => {
    if (!family?.id) return
    checkKB()
  }, [family?.id])

  async function checkKB() {
    setKbData(undefined)
    const { data: infoRows } = await supabase
      .from('info_bank')
      .select('data')
      .eq('family_id', family.id)
      .eq('section', 'school')

    const urls = (infoRows ?? [])
      .map(r => normaliseOrigin(r.data?.school_url))
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)

    if (!urls.length) { setKbData(null); return }

    const { data: cals } = await supabase
      .from('school_calendars')
      .select('homepage_url, school_name, term_dates, last_fetched_at')
      .in('homepage_url', urls)

    const found = (cals ?? []).filter(c => c.term_dates?.length > 0)
    setKbData(found.length > 0 ? found : null)
  }

  async function importFromKB() {
    setKbImporting(true)
    setKbMsg(null)
    const { data: res, error } = await supabase.functions.invoke('check-term-dates', { body: {} })
    setKbImporting(false)
    if (error) { setKbMsg({ type: 'error', msg: 'Import failed. Please try again.' }); return }
    const results = res?.results ?? []
    const totalAdded = results.reduce((s, r) => s + (r.eventsAdded ?? 0), 0)
    if (totalAdded > 0) {
      setKbMsg({ type: 'success', msg: `${totalAdded} date${totalAdded !== 1 ? 's' : ''} added.` })
      loadEvents()
    } else if (results.some(r => r.status === 'error')) {
      setKbMsg({ type: 'error', msg: 'Could not import dates. Try using photos instead.' })
    } else {
      setKbMsg({ type: 'info', msg: 'Calendar already up to date.' })
    }
  }

  async function handlePhotoFiles(files) {
    if (!files.length) return
    setPhotoFileCount(files.length)
    setPhotoProcessing(true)
    setPhotoDates(null)
    setPhotoMsg(null)

    const images = await Promise.all(
      Array.from(files).map(
        file => new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = e => resolve({
            base64: e.target.result.split(',')[1],
            media_type: file.type || 'image/jpeg',
          })
          reader.readAsDataURL(file)
        })
      )
    )

    const { data: res, error } = await supabase.functions.invoke('extract-school-info', {
      body: { family_id: family?.id, images },
    })
    setPhotoProcessing(false)

    if (error || res?.error) {
      setPhotoMsg({ type: 'error', msg: res?.error ?? 'Could not read the images.' })
      return
    }
    if (!res?.dates?.length) {
      setPhotoMsg({ type: 'info', msg: 'No term dates found in these images. Try a clearer photo of the term dates.' })
      return
    }
    setPhotoDates(res.dates)
  }

  async function savePhotoDates() {
    if (!photoDates?.length) return
    setPhotoSaving(true)
    let added = 0
    for (const ev of photoDates) {
      if (!ev.date || !ev.title) continue
      const { error } = await supabase.rpc('create_family_event', {
        p_family_id:      family.id,
        p_title:          ev.title,
        p_event_date:     ev.date,
        p_end_date:       ev.end_date ?? null,
        p_source:         'term_dates',
        p_source_subject: 'School term dates',
      })
      if (!error) added++
    }
    setPhotoSaving(false)
    if (added > 0) {
      setPhotoDates(null)
      setPhotoFileCount(0)
      setPhotoMsg({ type: 'success', msg: `${added} date${added !== 1 ? 's' : ''} saved.` })
      loadEvents()
    } else {
      setPhotoMsg({ type: 'info', msg: 'All these dates are already in your calendar.' })
    }
  }

  async function addManually() {
    const title = addType === 'inset'
      ? 'INSET Day'
      : (addTitle === 'Other' ? addCustom.trim() : addTitle)
    if (!addDate) { setAddError('Enter a date.'); return }
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
    setAddDate('')
    setAddEnd('')
    loadEvents()
  }

  async function removeEvent(id) {
    await supabase.from('family_events').delete().eq('id', id)
    setEvents(p => p.filter(e => e.id !== id))
  }

  const msgCls = t => t === 'error' ? 'text-red-600' : t === 'success' ? 'text-green-600' : 'text-gray-500'

  function togglePanel(id) {
    setOpenPanel(prev => {
      if (prev === id) return null
      // Reset photo state when leaving photos panel
      if (prev === 'photos') { setPhotoDates(null); setPhotoFileCount(0); setPhotoMsg(null) }
      if (id === 'kb')     setKbMsg(null)
      if (id === 'manual') setAddError(null)
      return id
    })
  }

  if (loading) return <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>

  const kbAvailable = Array.isArray(kbData) && kbData.length > 0

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Existing term dates list */}
      {events.length === 0 ? (
        <p className="text-sm text-gray-400">No term dates added yet.</p>
      ) : (
        <div className="space-y-1.5">
          {events.map(ev => {
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
                  <button onClick={() => removeEvent(ev.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">
                    Remove
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add options — parents only */}
      {isParent && (
        <div className="space-y-2 pt-1">

          {/* ── (a) Knowledge Base ── */}
          <OptionPanel
            label="Add from Canopy Knowledge Base"
            description={
              kbData === undefined ? 'Checking…' :
              kbAvailable
                ? kbData.map(c => c.school_name ?? 'Your school').join(' · ')
                : 'Not yet available for your school'
            }
            disabled={!kbAvailable}
            open={openPanel === 'kb'}
            onToggle={() => togglePanel('kb')}
          >
            {kbData?.map(cal => (
              <div key={cal.homepage_url} className="mb-3 space-y-0.5">
                <p className="text-sm font-medium text-gray-800">{cal.school_name ?? cal.homepage_url}</p>
                <p className="text-xs text-gray-400">
                  {cal.term_dates.length} dates available
                  {cal.last_fetched_at ? ` · last updated ${format(new Date(cal.last_fetched_at), 'd MMM yyyy')}` : ''}
                </p>
              </div>
            ))}
            {kbMsg && <p className={`text-xs font-medium mb-2 ${msgCls(kbMsg.type)}`}>{kbMsg.msg}</p>}
            <Button className="w-full py-2.5 text-sm" loading={kbImporting} onClick={importFromKB}>
              Import term dates
            </Button>
          </OptionPanel>

          {/* ── (b) Photos ── */}
          <OptionPanel
            label="Add from photos"
            description="Upload one or more photos of a term dates letter or calendar"
            open={openPanel === 'photos'}
            onToggle={() => togglePanel('photos')}
          >
            {photoDates ? (
              // Review step
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  {photoDates.length} date{photoDates.length !== 1 ? 's' : ''} found — remove any that look wrong, then save.
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {photoDates.map((ev, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${ev.title?.toLowerCase().includes('inset') ? 'bg-amber-400' : 'bg-purple-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{ev.title}</p>
                        <p className="text-xs text-gray-400">
                          {ev.date && format(parseISO(ev.date), 'd MMM yyyy')}
                          {ev.end_date && ` – ${format(parseISO(ev.end_date), 'd MMM yyyy')}`}
                        </p>
                      </div>
                      <button
                        onClick={() => setPhotoDates(p => p.filter((_, j) => j !== i))}
                        className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {photoMsg && <p className={`text-xs font-medium ${msgCls(photoMsg.type)}`}>{photoMsg.msg}</p>}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 py-2.5 text-sm"
                    loading={photoSaving}
                    onClick={savePhotoDates}
                    disabled={!photoDates.length}
                  >
                    Save {photoDates.length} date{photoDates.length !== 1 ? 's' : ''}
                  </Button>
                  <button
                    onClick={() => { setPhotoDates(null); setPhotoFileCount(0); setPhotoMsg(null) }}
                    className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // Upload step
              <div className="space-y-2">
                {photoProcessing ? (
                  <div className="flex items-center gap-3 py-3">
                    <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-sm text-gray-600">
                      Reading {photoFileCount} photo{photoFileCount !== 1 ? 's' : ''}…
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={() => photosRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
                  >
                    Tap to choose photos
                  </button>
                )}
                {photoMsg && <p className={`text-xs font-medium ${msgCls(photoMsg.type)}`}>{photoMsg.msg}</p>}
                <input
                  ref={photosRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files?.length) handlePhotoFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>
            )}
          </OptionPanel>

          {/* ── (c) Manual ── */}
          <OptionPanel
            label="Add manually"
            description="Enter a single INSET day or holiday period"
            open={openPanel === 'manual'}
            onToggle={() => togglePanel('manual')}
          >
            <div className="space-y-3">
              {/* Type toggle */}
              <div className="flex gap-2">
                {[['holiday', 'School Holiday'], ['inset', 'INSET Day']].map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setAddType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      addType === t
                        ? 'border-canopy-mid bg-canopy-frost text-canopy-deep'
                        : 'border-gray-200 bg-white text-gray-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Title selector (holidays only) */}
              {addType === 'holiday' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Title</label>
                  <select
                    value={addTitle}
                    onChange={e => setAddTitle(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  >
                    {HOLIDAY_TITLES.map(t => <option key={t}>{t}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {addTitle === 'Other' && (
                    <input
                      type="text"
                      value={addCustom}
                      onChange={e => setAddCustom(e.target.value)}
                      placeholder="Holiday name"
                      className="w-full mt-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                    />
                  )}
                </div>
              )}

              {/* Date inputs */}
              <div className={addType === 'holiday' ? 'grid grid-cols-2 gap-2' : ''}>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    {addType === 'holiday' ? 'Start date' : 'Date'}
                  </label>
                  <input
                    type="date"
                    value={addDate}
                    onChange={e => setAddDate(e.target.value)}
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
                      onChange={e => setAddEnd(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                    />
                  </div>
                )}
              </div>

              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <Button className="w-full py-2.5 text-sm" loading={addSaving} onClick={addManually}>
                Add
              </Button>
            </div>
          </OptionPanel>

        </div>
      )}
    </div>
  )
}

// ── Option panel accordion ────────────────────────────────────────────────────

function OptionPanel({ label, description, disabled = false, open, onToggle, children }) {
  return (
    <div className={`border rounded-xl overflow-hidden ${disabled ? 'border-gray-100' : 'border-gray-200 bg-white'}`}>
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className={`w-full flex items-start gap-3 px-3 py-3 text-left ${!disabled ? 'hover:bg-gray-50 transition-colors' : ''}`}
      >
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-800'}`}>{label}</p>
          <p className={`text-xs mt-0.5 ${disabled ? 'text-gray-300' : 'text-gray-400'}`}>{description}</p>
        </div>
        {!disabled && (
          <svg
            className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {open && !disabled && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-3">
          {children}
        </div>
      )}
    </div>
  )
}
