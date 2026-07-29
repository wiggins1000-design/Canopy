import { useState, useEffect, useRef, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useLocale } from '../../hooks/useLocale'
import { canonicalSchoolKey } from '../../lib/termDatesUtils'
import Button from '../ui/Button'
import BottomSheet from '../ui/BottomSheet'

// Kept in sync with classifyTermEvent in termDatesUtils.js (used for the calendar's
// coloured strips) — see that file's INSET_RE for the full cross-locale keyword list.
const CLASSIFY_INSET_RE = /\b(inset|baker\s+day|occasional\s+day|pd\s+day|professional\s+development|teacher\s+work\s?day|non.?student\s+day|records?\s+day|pupil.?free|student.?free|curriculum\s+day|school\s+development\s+day|staff\s+development|in.?service)\b/

function classify(ev) {
  if (CLASSIFY_INSET_RE.test(ev.title.toLowerCase())) return 'inset'
  if (ev.end_date) return 'holiday'
  return 'other'
}

function normaliseUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const base = `${u.protocol}//${u.hostname}`.toLowerCase()
    const hasPath = u.pathname.length > 1 || u.search.length > 0
    return hasPath ? (base + u.pathname + u.search).toLowerCase() : base
  } catch { return null }
}

export default function TermDatesSection({ onNewDates }) {
  const { family, isParent } = useFamily()
  const regionConfig = useLocale()
  const holidayTitles = regionConfig.termLabels.holidays
  const [events, setEvents]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [showInspect, setShowInspect] = useState(false)
  const [showAddOptions, setShowAddOptions] = useState(false)
  const [openPanel, setOpenPanel]     = useState(null) // 'kb' | 'photos' | 'manual'

  // Inspect sheet — inline edit
  const [editingId, setEditingId]     = useState(null)
  const [editTitle, setEditTitle]     = useState('')
  const [editDate, setEditDate]       = useState('')
  const [editEnd, setEditEnd]         = useState('')
  const [editSaving, setEditSaving]   = useState(false)

  // Inspect sheet — delete school
  const [deleteSchoolTarget, setDeleteSchoolTarget] = useState(null) // { school, count, rawNames }
  const [deleteSchoolDeleting, setDeleteSchoolDeleting] = useState(false)

  // Inspect sheet — inline add
  const [showInspectAdd, setShowInspectAdd] = useState(false)
  const [iAddType, setIAddType]   = useState('holiday')
  const [iAddTitle, setIAddTitle] = useState(() => regionConfig.termLabels.holidays[0])
  const [iAddCustom, setIAddCustom] = useState('')
  const [iAddDate, setIAddDate]   = useState('')
  const [iAddEnd, setIAddEnd]     = useState('')
  const [iAddSaving, setIAddSaving] = useState(false)
  const [iAddError, setIAddError] = useState(null)

  // Knowledge Base
  const [kbData, setKbData]           = useState(undefined) // undefined=checking, null=none, arr=found
  const [kbImporting, setKbImporting] = useState(false)
  const [kbMsg, setKbMsg]             = useState(null)
  const [failedSchoolNames, setFailedSchoolNames] = useState([])
  const [kbRefreshing, setKbRefreshing] = useState(false)

  // Photos
  const photosRef                         = useRef(null)
  const [photoImages, setPhotoImages]     = useState([]) // accumulated base64 images
  const [photoFileCount, setPhotoFileCount] = useState(0)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [photoDates, setPhotoDates]       = useState(null) // null=not started, arr=review list
  const [photoSaving, setPhotoSaving]     = useState(false)
  const [photoMsg, setPhotoMsg]           = useState(null)

  // Manual
  const [addType, setAddType]   = useState('holiday')
  const [addTitle, setAddTitle] = useState(() => regionConfig.termLabels.holidays[0])
  const [addCustom, setAddCustom] = useState('')
  const [addDate, setAddDate]   = useState('')
  const [addEnd, setAddEnd]     = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState(null)

  // School pickers — one selected-value + one custom-text per panel
  const [photoSchool, setPhotoSchool]           = useState('')
  const [photoSchoolCustom, setPhotoSchoolCustom] = useState('')
  const [manualSchool, setManualSchool]           = useState('')
  const [manualSchoolCustom, setManualSchoolCustom] = useState('')
  const [iAddSchool, setIAddSchool]               = useState('')
  const [iAddSchoolCustom, setIAddSchoolCustom]   = useState('')

  const thisYear = new Date().getFullYear()

  const hasNewDates = useMemo(() => {
    if (!kbData?.length) return false
    const inCalendar = new Set(events.map(e => `${e.event_date}|${e.title}`))
    return kbData.some(cal =>
      (cal.term_dates ?? []).some(d => d.date && d.title && !inCalendar.has(`${d.date}|${d.title}`))
    )
  }, [kbData, events])

  useEffect(() => { onNewDates?.(hasNewDates) }, [hasNewDates])

  // School options derived from KB data + previously used names in existing events.
  // Deduped by canonical key so a name-variant of the same school (e.g. "St. Nicholas"
  // vs "St Nicholas" from two siblings' Info Bank records) doesn't offer two near-
  // identical picker entries — see canonicalSchoolKey in termDatesUtils.js.
  const schoolOptions = useMemo(() => {
    const byKey = new Map()
    for (const cal of kbData ?? []) {
      const name = cal.school_name ?? cal.homepage_url
      if (name && !byKey.has(canonicalSchoolKey(name))) byKey.set(canonicalSchoolKey(name), name)
    }
    for (const ev of events) {
      const name = ev.source_subject
      if (name && !byKey.has(canonicalSchoolKey(name))) byKey.set(canonicalSchoolKey(name), name)
    }
    return [...byKey.values()]
  }, [kbData, events])

  // Set default school picker value once options are available
  useEffect(() => {
    if (!schoolOptions.length) return
    setPhotoSchool(prev  => prev || schoolOptions[0])
    setManualSchool(prev => prev || schoolOptions[0])
    setIAddSchool(prev   => prev || schoolOptions[0])
  }, [schoolOptions])

  function resolveSchool(school, custom) {
    if (school === '__other__') return custom.trim() || 'School term dates'
    return school || schoolOptions[0] || 'School term dates'
  }

  async function loadEvents() {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('family_events')
      .select('id, title, event_date, end_date, source_subject')
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
    const found = await fetchKBData()
    setKbData(found)
    return found
  }

  async function fetchKBData() {
    const { data: infoRows } = await supabase
      .from('info_bank')
      .select('data')
      .eq('family_id', family.id)
      .eq('section', 'school')

    const urlNamePairs = (infoRows ?? [])
      .map(r => ({ url: normaliseUrl(r.data?.school_url), name: r.data?.school_name }))
      .filter(p => p.url)
      .filter((p, i, arr) => arr.findIndex(q => q.url === p.url) === i)

    if (!urlNamePairs.length) return null

    const urls = urlNamePairs.map(p => p.url)
    const infoNames = Object.fromEntries(urlNamePairs.map(p => [p.url, p.name]).filter(([, n]) => n))

    const { data: cals } = await supabase
      .from('school_calendars')
      .select('id, homepage_url, school_name, term_dates, last_fetched_at')
      .in('homepage_url', urls)

    const calByUrl = Object.fromEntries((cals ?? []).map(c => [c.homepage_url, c]))

    // Return ALL configured schools — ones without a cache entry show as "Not yet synced"
    const all = urlNamePairs.map(({ url }) => {
      const cal = calByUrl[url]
      return cal
        ? { ...cal, school_name: cal.school_name ?? infoNames[url] }
        : { homepage_url: url, school_name: infoNames[url] ?? url, term_dates: [], last_fetched_at: null }
    })

    return all.length > 0 ? all : null
  }

  async function importFromKB(dataOverride, { suppressMessage = false } = {}) {
    const data = dataOverride ?? kbData
    if (!data?.length) return
    setKbImporting(true)
    if (!suppressMessage) setKbMsg(null)
    let added = 0
    let updated = 0

    // Cutoff: don't insert events more than 1 month in the past
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 1)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    // Query DB fresh so dedup isn't based on potentially stale React state
    const { data: currentEvents } = await supabase
      .from('family_events')
      .select('event_date, title')
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
    const seen = new Set((currentEvents ?? []).map(e => `${e.event_date}|${e.title}`))

    for (const cal of data) {
      const schoolLabel = cal.school_name ?? cal.homepage_url
      const pairs = []  // all valid {date, title} pairs — used for retag, not filtered by cutoff

      for (const ev of cal.term_dates ?? []) {
        if (!ev.date || !ev.title) continue
        pairs.push({ date: ev.date, title: ev.title })

        if (ev.date < cutoffStr) continue  // cutoff applies to calendar inserts only

        const key = `${ev.date}|${ev.title}`
        if (!seen.has(key)) {
          const { error } = await supabase.rpc('create_family_event', {
            p_family_id:          family.id,
            p_title:              ev.title,
            p_event_date:         ev.date,
            p_end_date:           ev.end_date ?? null,
            p_source:             'term_dates',
            p_source_subject:     schoolLabel,
            p_school_calendar_id: cal.id ?? null,
          })
          if (!error) { added++; seen.add(key) }
        }
      }

      // Retag any existing events that match this school's dates but still carry
      // the generic 'School term dates' label. Done server-side so it covers all
      // dates regardless of the client's load window.
      if (pairs.length) {
        const { data: retagCount } = await supabase.rpc('retag_term_dates', {
          p_family_id:    family.id,
          p_school_label: schoolLabel,
          p_pairs:        pairs,
        })
        updated += retagCount ?? 0
      }
    }

    setKbImporting(false)
    if (added > 0 || updated > 0) {
      if (!suppressMessage) {
        const parts = []
        if (added)   parts.push(`${added} date${added !== 1 ? 's' : ''} added`)
        if (updated) parts.push(`${updated} labelled with school name`)
        setKbMsg({ type: 'success', msg: `${parts.join(', ')}.` })
      }
      loadEvents()
    } else if (!suppressMessage) {
      setKbMsg({ type: 'info', msg: 'Calendar already up to date.' })
    }
  }

  async function syncFromSchool() {
    setKbRefreshing(true)
    setKbMsg(null)

    const { data: fnData, error } = await supabase.functions.invoke('check-term-dates', { body: {} })
    if (error) {
      setKbRefreshing(false)
      setKbMsg({ type: 'error', msg: 'Could not reach school website.' })
      return
    }

    const results  = fnData?.results ?? []

    // Backend already skips scraping entirely when there's no school saved in Info Bank
    // for this family (empty results + this specific message) — surface that clearly
    // instead of silently showing an empty message box.
    if (results.length === 0 && fnData?.message === 'No school URLs configured') {
      setKbMsg({ type: 'error', msg: 'No school added yet — add your child’s school in Info Bank → School, then try syncing again.' })
      setKbRefreshing(false)
      return
    }

    const failures = results.filter(r => r.status === 'error' || r.status === 'no_dates')
    // "Succeeded" but implausibly thin (fewer than 5 dates, or missing Christmas/New Year
    // coverage) — the backend already searched harder and this is the best it could find,
    // so it's worth the same "please check/add manually" treatment as an outright failure
    // rather than being shown as a plain success.
    const thin      = results.filter(r => r.status === 'ok' && r.lowConfidence)
    const scraped   = results.filter(r => r.status === 'ok' && !r.lowConfidence)

    // Reload KB data so the panel shows updated counts; the edge function
    // already applied filtered events to the calendar — no KB import needed here.
    const freshData = await fetchKBData()
    setKbData(freshData)
    loadEvents()

    // Build school name lookup: KB data first, then info_bank as fallback
    const nameFromKB = Object.fromEntries((freshData ?? []).map(c => [c.homepage_url, c.school_name]))
    const { data: infoRows } = await supabase.from('info_bank')
      .select('data').eq('family_id', family.id).eq('section', 'school')
    const nameFromInfo = {}
    for (const r of infoRows ?? []) {
      const url = normaliseUrl(r.data?.school_url)
      if (url && r.data?.school_name) nameFromInfo[url] = r.data.school_name
    }
    const resolveName = url =>
      nameFromKB[url] ?? nameFromInfo[url] ??
      (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } })()

    // One status line per school
    const lines = results.map(r => {
      const name = resolveName(r.homepageUrl)
      if (r.status === 'error' || r.status === 'no_dates') {
        return `${name}: Couldn't read dates — add via photos or manually below`
      }
      if (r.lowConfidence) {
        return `${name}: Only found ${r.totalDates} date${r.totalDates !== 1 ? 's' : ''} — this may be incomplete. Check the school's website or add missing dates below.`
      }
      return r.eventsAdded > 0
        ? `${name}: ${r.eventsAdded} new date${r.eventsAdded !== 1 ? 's' : ''} added`
        : `${name}: Calendar up to date`
    })

    setKbMsg({ type: (failures.length || thin.length) ? 'error' : 'info', msg: lines.join('\n') })

    // If any schools failed or came back suspiciously thin, open the photos panel
    // pre-set to the first one needing attention.
    if (failures.length || thin.length) {
      const needsAttentionNames = [...failures, ...thin].map(r => resolveName(r.homepageUrl))
      setFailedSchoolNames(needsAttentionNames)
      setShowAddOptions(true)
      setPhotoSchool(needsAttentionNames[0])
      setManualSchool(needsAttentionNames[0])
      setIAddSchool(needsAttentionNames[0])
      setOpenPanel('photos')
    } else {
      setFailedSchoolNames([])
    }

    setKbRefreshing(false)
  }

  function mapSyncError(error) {
    if (!error || error === 'no_dates') return 'no dates found on website'
    if (error.includes('blocking') || error.includes('403')) return 'website is blocking access'
    if (error.includes('Failed to fetch school homepage')) return 'could not reach the school website'
    if (error.includes('Could not find')) return 'could not find the term dates page'
    if (error.includes('Failed to fetch term dates')) return 'term dates page could not be loaded'
    if (error.includes('extract dates')) return 'page found but dates could not be read'
    return error.length < 80 ? error : 'check that the school website is accessible'
  }

  async function handlePhotoFiles(files) {
    if (!files.length) return
    setPhotoProcessing(true)
    setPhotoDates(null)
    setPhotoMsg(null)

    const newImages = await Promise.all(
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

    // Always send ALL accumulated images together so cross-photo inference works
    const allImages = [...photoImages, ...newImages]
    setPhotoImages(allImages)
    setPhotoFileCount(allImages.length)

    const { data: res, error } = await supabase.functions.invoke('extract-school-info', {
      body: { family_id: family?.id, images: allImages },
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
    setPhotoDates(res.dates.slice().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')))
  }

  async function savePhotoDates() {
    if (!photoDates?.length) return
    setPhotoSaving(true)
    const schoolLabel = resolveSchool(photoSchool, photoSchoolCustom)
    let added = 0
    let lastError = null
    for (const ev of photoDates) {
      if (!ev.date || !ev.title) continue
      const { error } = await supabase.rpc('create_family_event', {
        p_family_id:          family.id,
        p_title:              ev.title,
        p_event_date:         ev.date,
        p_end_date:           ev.end_date || null,
        p_source:             'term_dates',
        p_source_subject:     schoolLabel,
        p_school_calendar_id: null,
      })
      if (!error) added++
      else lastError = error
    }
    setPhotoSaving(false)
    if (added > 0) {
      setPhotoDates(null)
      setPhotoImages([])
      setPhotoFileCount(0)
      setPhotoMsg({ type: 'success', msg: `${added} date${added !== 1 ? 's' : ''} saved.` })
      loadEvents()
    } else if (lastError) {
      setPhotoMsg({ type: 'error', msg: `Could not save dates: ${lastError.message ?? JSON.stringify(lastError)}` })
    } else {
      setPhotoMsg({ type: 'info', msg: 'All these dates are already in your calendar.' })
    }
  }

  async function addManually() {
    const title = addType === 'inset'
      ? regionConfig.termLabels.insetDay
      : (addTitle === 'Other' ? addCustom.trim() : addTitle)
    if (!addDate) { setAddError('Enter a date.'); return }
    if (addType === 'holiday' && !addEnd) { setAddError('Enter an end date.'); return }
    if (addType === 'holiday' && addEnd < addDate) { setAddError('End date must be after start date.'); return }
    setAddSaving(true)
    setAddError(null)
    const { error } = await supabase.rpc('create_family_event', {
      p_family_id:          family.id,
      p_title:              title,
      p_event_date:         addDate,
      p_end_date:           addType === 'holiday' ? addEnd : null,
      p_source:             'term_dates',
      p_source_subject:     resolveSchool(manualSchool, manualSchoolCustom),
      p_school_calendar_id: null,
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

  async function deleteSchool() {
    if (!deleteSchoolTarget) return
    setDeleteSchoolDeleting(true)
    const { rawNames } = deleteSchoolTarget
    await supabase.from('family_events').delete()
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
      .in('source_subject', rawNames)
    setEvents(p => p.filter(e => !rawNames.includes(e.source_subject)))
    setDeleteSchoolDeleting(false)
    setDeleteSchoolTarget(null)
  }

  function startEdit(ev) {
    setEditingId(ev.id)
    setEditTitle(ev.title)
    setEditDate(ev.event_date)
    setEditEnd(ev.end_date ?? '')
  }

  async function saveEdit(ev) {
    setEditSaving(true)
    await supabase.from('family_events').update({
      title: editTitle.trim() || ev.title,
      event_date: editDate,
      end_date: editEnd || null,
    }).eq('id', ev.id)
    setEditSaving(false)
    setEditingId(null)
    loadEvents()
  }

  async function addInInspect() {
    const title = iAddType === 'inset'
      ? regionConfig.termLabels.insetDay
      : (iAddTitle === 'Other' ? iAddCustom.trim() : iAddTitle)
    if (!iAddDate) { setIAddError('Enter a date.'); return }
    if (iAddType === 'holiday' && !iAddEnd) { setIAddError('Enter an end date.'); return }
    if (iAddType === 'holiday' && iAddEnd < iAddDate) { setIAddError('End date must be after start date.'); return }
    setIAddSaving(true)
    setIAddError(null)
    const { error } = await supabase.rpc('create_family_event', {
      p_family_id:          family.id,
      p_title:              title,
      p_event_date:         iAddDate,
      p_end_date:           iAddType === 'holiday' ? iAddEnd : null,
      p_source:             'term_dates',
      p_source_subject:     resolveSchool(iAddSchool, iAddSchoolCustom),
      p_school_calendar_id: null,
    })
    setIAddSaving(false)
    if (error) { setIAddError(error.message); return }
    setIAddDate('')
    setIAddEnd('')
    setShowInspectAdd(false)
    loadEvents()
  }

  const dateRange = useMemo(() => {
    if (!events.length) return null
    const first = events[0].event_date
    const last  = events[events.length - 1].event_date
    return `${format(parseISO(first), 'MMM yyyy')} – ${format(parseISO(last), 'MMM yyyy')}`
  }, [events])

  const schoolCount = useMemo(() => {
    return new Set(events.map(e => e.source_subject).filter(Boolean).map(canonicalSchoolKey)).size
  }, [events])

  // Grouped by canonical key, not the raw source_subject, so a name-variant of the
  // same school (e.g. two siblings' records for "St. Nicholas" vs "St Nicholas")
  // shows as one group instead of two — see canonicalSchoolKey in termDatesUtils.js.
  // rawNames tracks every literal source_subject folded into this group, since
  // "Delete all" needs to remove rows under any of them, not just one exact string.
  const groupedEvents = useMemo(() => {
    const groups = new Map() // canonicalKey -> { label, events, rawNames: Set }
    for (const ev of events) {
      const raw = ev.source_subject || ''
      const key = canonicalSchoolKey(raw)
      if (!groups.has(key)) groups.set(key, { label: raw, events: [], rawNames: new Set() })
      const g = groups.get(key)
      g.events.push(ev)
      g.rawNames.add(raw)
    }
    return [...groups.values()].map(g => [g.label, g.events, [...g.rawNames]])
  }, [events])

  const msgCls = t => t === 'error' ? 'text-red-600' : t === 'success' ? 'text-green-600' : 'text-gray-500'

  function togglePanel(id) {
    setOpenPanel(prev => {
      if (prev === id) return null
      // Reset photo state when leaving photos panel
      if (prev === 'photos') { setPhotoDates(null); setPhotoImages([]); setPhotoFileCount(0); setPhotoMsg(null) }
      if (id === 'kb')     setKbMsg(null)
      if (id === 'manual') setAddError(null)
      return id
    })
  }

  if (loading) return <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>

  const kbAvailable = Array.isArray(kbData) && kbData.length > 0

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Summary row */}
      {events.length === 0 ? (
        <p className="text-sm text-gray-400">No term dates added yet.</p>
      ) : (
        <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {events.length} term dates{schoolCount > 1 ? ` · ${schoolCount} schools` : ''}
            </p>
            {dateRange && <p className="text-xs text-gray-400">{dateRange}</p>}
          </div>
          <button
            onClick={() => setShowInspect(true)}
            className="text-xs font-medium text-canopy-mid hover:text-canopy-deep shrink-0"
          >
            Inspect
          </button>
        </div>
      )}

      {/* Inspect bottom sheet */}
      <BottomSheet open={showInspect} onClose={() => { setShowInspect(false); setEditingId(null); setShowInspectAdd(false); setDeleteSchoolTarget(null) }} title="Term Dates">
        <div className="px-4 py-3 space-y-4">
          {groupedEvents.map(([school, evs, rawNames]) => (
            <div key={school}>
              {groupedEvents.length > 1 && (
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{school}</p>
                  {isParent && school && deleteSchoolTarget?.school !== school && (
                    <button
                      onClick={() => setDeleteSchoolTarget({ school, count: evs.length, rawNames })}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Delete all
                    </button>
                  )}
                </div>
              )}
              {deleteSchoolTarget?.school === school && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-2 space-y-2">
                  <p className="text-xs font-medium text-red-800">
                    Delete all {deleteSchoolTarget.count} term dates for {school}?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteSchoolTarget(null)}
                      className="flex-1 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteSchool}
                      disabled={deleteSchoolDeleting}
                      className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {deleteSchoolDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                {evs.map(ev => {
                  const type = classify(ev)
                  const isEditing = editingId === ev.id
                  return (
                    <div key={ev.id} className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-gray-500 block mb-1">Start date</label>
                              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-canopy-green" />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block mb-1">End date</label>
                              <input type="date" value={editEnd} min={editDate} onChange={e => setEditEnd(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-canopy-green" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(ev)} disabled={editSaving} className="flex-1 py-1.5 text-xs bg-canopy-mid text-white rounded-lg font-medium disabled:opacity-50">
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)} className="flex-1 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${type === 'inset' ? 'bg-amber-400' : 'bg-purple-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{ev.title}</p>
                            <p className="text-xs text-gray-400">
                              {format(parseISO(ev.event_date), 'd MMM yyyy')}
                              {ev.end_date && ` – ${format(parseISO(ev.end_date), 'd MMM yyyy')}`}
                            </p>
                          </div>
                          {isParent && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => startEdit(ev)} className="text-xs text-canopy-mid hover:text-canopy-deep px-1">
                                Edit
                              </button>
                              <button onClick={() => removeEvent(ev.id)} className="text-xs text-red-400 hover:text-red-600 px-1">
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Add date inline */}
          {isParent && (
            <div className="pt-1 border-t border-gray-100">
              {!showInspectAdd ? (
                <button
                  onClick={() => setShowInspectAdd(true)}
                  className="w-full py-2.5 text-sm text-canopy-mid font-medium border border-dashed border-canopy-mist rounded-xl hover:bg-canopy-frost transition-colors"
                >
                  + Add date
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-700">Add date</p>
                  <SchoolPicker
                    value={iAddSchool}
                    onChange={setIAddSchool}
                    customValue={iAddSchoolCustom}
                    onCustomChange={setIAddSchoolCustom}
                    options={schoolOptions}
                  />
                  <div className="flex gap-2">
                    {[['holiday', 'Holiday'], ['inset', regionConfig.termLabels.insetDay]].map(([t, label]) => (
                      <button
                        key={t}
                        onClick={() => setIAddType(t)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          iAddType === t
                            ? 'border-canopy-mid bg-canopy-frost text-canopy-deep'
                            : 'border-gray-200 bg-white text-gray-500'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {iAddType === 'holiday' && (
                    <div>
                      <select
                        value={iAddTitle}
                        onChange={e => setIAddTitle(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
                      >
                        {holidayTitles.map(t => <option key={t}>{t}</option>)}
                        <option value="Other">Other…</option>
                      </select>
                      {iAddTitle === 'Other' && (
                        <input
                          type="text"
                          value={iAddCustom}
                          onChange={e => setIAddCustom(e.target.value)}
                          placeholder="Holiday name"
                          className="w-full mt-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                        />
                      )}
                    </div>
                  )}
                  <div className={iAddType === 'holiday' ? 'grid grid-cols-2 gap-2' : ''}>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">{iAddType === 'holiday' ? 'Start date' : 'Date'}</label>
                      <input type="date" value={iAddDate} onChange={e => setIAddDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green" />
                    </div>
                    {iAddType === 'holiday' && (
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">End date</label>
                        <input type="date" value={iAddEnd} min={iAddDate} onChange={e => setIAddEnd(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green" />
                      </div>
                    )}
                  </div>
                  {iAddError && <p className="text-xs text-red-600">{iAddError}</p>}
                  <div className="flex gap-2">
                    <Button className="flex-1 py-2 text-sm" loading={iAddSaving} onClick={addInInspect}>
                      Add
                    </Button>
                    <button
                      onClick={() => { setShowInspectAdd(false); setIAddError(null); setIAddDate(''); setIAddEnd('') }}
                      className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Sync failure notice — shown outside accordions so it persists when photos panel opens */}
      {failedSchoolNames.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <p className="text-xs font-medium text-red-700">
            Couldn't read dates from {failedSchoolNames.join(' and ')} — add via photos or manually below.
          </p>
        </div>
      )}

      {/* Add options — parents only */}
      {isParent && (
        <div className="space-y-2 pt-1">
          {/* When dates exist, collapse panels behind a toggle unless KB has new dates */}
          {events.length > 0 && !hasNewDates && !showAddOptions && (
            <button
              onClick={() => setShowAddOptions(true)}
              className="w-full text-left px-3 py-2.5 border border-gray-200 rounded-xl bg-white flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm text-gray-500">Add or update dates</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {/* KB panel: visible whenever calendar is empty, KB has new dates, or user expanded */}
          {(events.length === 0 || hasNewDates || showAddOptions) && (
          <OptionPanel
            label="Add from Canopy Knowledge Base"
            description={
              kbData === undefined ? 'Checking…' :
              kbAvailable
                ? hasNewDates
                  ? `New dates available · ${kbData.map(c => c.school_name ?? 'Your school').join(', ')}`
                  : kbData.map(c => c.school_name ?? 'Your school').join(' · ')
                : 'Not yet available for your school'
            }
            disabled={!kbAvailable}
            badge={hasNewDates}
            open={openPanel === 'kb'}
            onToggle={() => togglePanel('kb')}
          >
            {kbData?.map(cal => (
              <div key={cal.homepage_url} className="mb-3 space-y-0.5">
                <p className="text-sm font-medium text-gray-800">{cal.school_name ?? cal.homepage_url}</p>
                <p className="text-xs text-gray-400">
                  {cal.term_dates?.length > 0
                    ? `${cal.term_dates.length} dates available${cal.last_fetched_at ? ` · last updated ${format(new Date(cal.last_fetched_at), 'd MMM yyyy')}` : ''}`
                    : 'Not yet synced'}
                </p>
              </div>
            ))}
            {kbMsg && <p className={`text-xs font-medium mb-2 whitespace-pre-line ${msgCls(kbMsg.type)}`}>{kbMsg.msg}</p>}
            <Button className="w-full py-2.5 text-sm" loading={kbRefreshing || kbImporting} onClick={syncFromSchool}>
              Sync from school website
            </Button>
          </OptionPanel>)}

          {/* Photos + manual: only when calendar is empty or user explicitly expanded */}
          {(events.length === 0 || showAddOptions) && (<>
          {/* ── (b) Photos ── */}
          <OptionPanel
            label="Add from photos"
            description={
              failedSchoolNames.length
                ? `For ${failedSchoolNames.join(' and ')} — upload a photo of the term dates`
                : 'Upload one or more photos of a term dates letter or calendar'
            }
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
                <SchoolPicker
                  value={photoSchool}
                  onChange={setPhotoSchool}
                  customValue={photoSchoolCustom}
                  onCustomChange={setPhotoSchoolCustom}
                  options={schoolOptions}
                />
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
                    onClick={() => photosRef.current?.click()}
                    disabled={photoProcessing}
                    className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
                    title="Add more photos"
                  >
                    + Photo
                  </button>
                  <button
                    onClick={() => { setPhotoDates(null); setPhotoImages([]); setPhotoFileCount(0); setPhotoMsg(null) }}
                    className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // Upload step
              <div className="space-y-3">
                <SchoolPicker
                  value={photoSchool}
                  onChange={setPhotoSchool}
                  customValue={photoSchoolCustom}
                  onCustomChange={setPhotoSchoolCustom}
                  options={schoolOptions}
                />
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
              </div>
            )}
            {/* Always mounted so photosRef works in both upload and review steps */}
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
          </OptionPanel>

          {/* ── (c) Manual ── */}
          <OptionPanel
            label="Add manually"
            description={
              failedSchoolNames.length
                ? `For ${failedSchoolNames.join(' and ')} — enter dates by hand`
                : 'Enter a single INSET day or holiday period'
            }
            open={openPanel === 'manual'}
            onToggle={() => togglePanel('manual')}
          >
            <div className="space-y-3">
              <SchoolPicker
                value={manualSchool}
                onChange={setManualSchool}
                customValue={manualSchoolCustom}
                onCustomChange={setManualSchoolCustom}
                options={schoolOptions}
              />
              {/* Type toggle */}
              <div className="flex gap-2">
                {[['holiday', regionConfig.termLabels.schoolHoliday], ['inset', regionConfig.termLabels.insetDay]].map(([t, label]) => (
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
                    {holidayTitles.map(t => <option key={t}>{t}</option>)}
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
          </>)}

        </div>
      )}
    </div>
  )
}

// ── School picker ─────────────────────────────────────────────────────────────

function SchoolPicker({ value, onChange, customValue, onCustomChange, options }) {
  const cls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green'
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">School</label>
      {options.length > 0 ? (
        <>
          <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
            <option value="__other__">Other school…</option>
          </select>
          {value === '__other__' && (
            <input
              type="text"
              value={customValue}
              onChange={e => onCustomChange(e.target.value)}
              placeholder="School name"
              className={`${cls} mt-2`}
            />
          )}
        </>
      ) : (
        <input
          type="text"
          value={customValue}
          onChange={e => onCustomChange(e.target.value)}
          placeholder="School name (e.g. Reddam House)"
          className={cls}
        />
      )}
    </div>
  )
}

// ── Option panel accordion ────────────────────────────────────────────────────

function OptionPanel({ label, description, disabled = false, badge = false, open, onToggle, children }) {
  return (
    <div className={`border rounded-xl overflow-hidden ${disabled ? 'border-gray-100' : 'border-gray-200 bg-white'}`}>
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className={`w-full flex items-start gap-3 px-3 py-3 text-left ${!disabled ? 'hover:bg-gray-50 transition-colors' : ''}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-800'}`}>{label}</p>
            {badge && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
          </div>
          <p className={`text-xs mt-0.5 ${disabled ? 'text-gray-300' : badge ? 'text-green-600 font-medium' : 'text-gray-400'}`}>{description}</p>
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
