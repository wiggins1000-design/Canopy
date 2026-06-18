// Pure functions shared by useTermDates hook and TermDatesSection component.
// No React, no Supabase — safe to import in tests without any mocking.

export function classifyTermEvent(title, endDate) {
  const lower = (title ?? '').toLowerCase()
  if (lower.includes('inset')) return 'inset'
  if (endDate) return 'holiday'
  return null
}

export function typePriority(type) {
  return type === 'inset' ? 2 : type === 'holiday' ? 1 : 0
}

// Converts a flat array of DB family_event rows (source='term_dates') into a
// Map<dateStr, Array<{type, schoolIndex, schoolName}>> that the calendar uses.
export function buildTermDaysMap(events) {
  const rows = events ?? []

  // Stable school indices: alphabetical sort so school 0 is always the same school
  const rawNames = [...new Set(rows.map(e => e.source_subject ?? 'School'))]
  rawNames.sort()
  const schoolIndex = Object.fromEntries(rawNames.map((name, i) => [name, i]))

  const map = new Map()
  for (const event of rows) {
    const type = classifyTermEvent(event.title, event.end_date)
    if (!type) continue
    const schoolName = event.source_subject ?? 'School'
    const idx = schoolIndex[schoolName] ?? 0
    const start = new Date(event.event_date + 'T00:00:00')
    const end   = event.end_date
      ? new Date(event.end_date + 'T00:00:00')
      : new Date(event.event_date + 'T00:00:00')

    const cur = new Date(start)
    while (cur <= end) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      const existing = map.get(ds) ?? []
      const schoolEntry = existing.find(e => e.schoolIndex === idx)
      if (!schoolEntry) {
        map.set(ds, [...existing, { type, schoolIndex: idx, schoolName }])
      } else if (typePriority(type) > typePriority(schoolEntry.type)) {
        // INSET overrides holiday for the same school on the same day
        map.set(ds, existing.map(e => e.schoolIndex === idx ? { ...e, type } : e))
      }
      cur.setDate(cur.getDate() + 1)
    }
  }
  return map
}

// Derives a short display name for a school from its full name.
// e.g. "Twyford CofE High School" → "Twyford"
//      "Ada Lovelace School"       → "Ada"
//      "Nunnery Wood Primary"      → "Nunnery"
//      "St Nicholas Primary"       → "St Nicholas"
export function shortSchoolName(name) {
  if (!name || name === 'School term dates' || name === 'School') return ''

  let s = name
    // Religious / governance qualifiers
    .replace(/\bc\.?\s*of\s*e\.?\b/gi, '')
    .replace(/\bchurch\s+of\s+england\b/gi, '')
    .replace(/\b(roman\s+catholic|catholic|rc|cofe|coe|va|vc|aided|controlled|foundation|trust)\b/gi, '')
    // School phase / type
    .replace(/\b(multi.?academy|mat|sixth\s+form)\b/gi, '')
    .replace(/\b(primary|junior|infant|lower|upper|middle|prep|preparatory)\b/gi, '')
    .replace(/\b(senior|secondary|high|grammar|academy|college|school|free|community|comprehensive|specialist|independent)\b/gi, '')
    // Gender / misc
    .replace(/\bfor\s+(girls|boys|students)\b/gi, '')
    .replace(/\b(girls'?|boys'?|mixed)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Drop leading "The" or orphaned "of"
  s = s.replace(/^(the|of)\s+/i, '').trim()

  // Strip trailing generic location / building words
  s = s.replace(/\s+(woods?|hill|park|green|lane|road|street|avenue|grove|close|rise|way|end|common|heath|moor|vale|meadow|fields?|house|lodge|manor|hall|court|place|gardens?|campus)\s*$/i, '').trim()

  if (!s) return name.split(/\s+/)[0]

  const words = s.split(/\s+/)

  // "St X" or "Our X" → keep first two words
  if (/^(st\.?|our)$/i.test(words[0]) && words.length >= 2) {
    return `${words[0]} ${words[1]}`
  }

  return words[0]
}

// Validates the manual-entry form before calling the RPC.
// Returns an error string or null.
export function validateManualEntry({ addType, addDate, addEnd }) {
  if (!addDate) return 'Enter a date.'
  if (addType === 'holiday' && !addEnd) return 'Enter an end date.'
  if (addType === 'holiday' && addEnd < addDate) return 'End date must be after start date.'
  return null
}

// Resolves the event title from the manual-entry form state.
export function resolveManualTitle({ addType, addTitle, addCustom }) {
  if (addType === 'inset') return 'INSET Day'
  if (addTitle === 'Other') return (addCustom ?? '').trim()
  return addTitle
}
