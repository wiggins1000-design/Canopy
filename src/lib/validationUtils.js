export function validateEmail(email) {
  if (!email) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'Enter a valid email address'
}

export function validateUrl(url) {
  if (!url) return null
  const withScheme = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
  try {
    const u = new URL(withScheme)
    if (!['http:', 'https:'].includes(u.protocol)) return 'URL must start with https://'
    if (!u.hostname.includes('.')) return 'Enter a full URL, e.g. https://stmarys.sch.uk'
    return null
  } catch {
    return 'Enter a valid URL, e.g. https://stmarys.sch.uk'
  }
}

// Merges a fresh school-info extraction into the Info Bank form state. Two distinct
// behaviours depending on WHY extraction just ran:
//  - schoolChanged=false (re-syncing the same school to fill gaps): only fill blanks,
//    never clobber something the parent already typed in themselves.
//  - schoolChanged=true (switched to a genuinely different school): replace these
//    fields outright, even to blank if the new site didn't have them. Otherwise a
//    field the OLD school had but the new one doesn't (or that this extraction just
//    failed to find) keeps showing the old school's value under the new school's
//    name — actively wrong data, not just incomplete.
export function mergeExtractedSchoolInfo(prev, info, schoolChanged) {
  if (schoolChanged) {
    return {
      ...prev,
      school_name:    info.school_name    || prev.school_name,
      school_address: info.school_address || '',
      school_phone:   info.school_phone   || '',
      school_email:   info.school_email   || '',
      head_teacher:   info.head_teacher   || '',
      hours:          info.school_hours   || '',
    }
  }
  return {
    ...prev,
    school_name:    prev.school_name    || info.school_name    || prev.school_name,
    school_address: prev.school_address || info.school_address || prev.school_address,
    school_phone:   prev.school_phone   || info.school_phone   || prev.school_phone,
    school_email:   prev.school_email   || info.school_email   || prev.school_email,
    head_teacher:   prev.head_teacher   || info.head_teacher   || prev.head_teacher,
    hours:          prev.hours          || info.school_hours   || prev.hours,
  }
}
