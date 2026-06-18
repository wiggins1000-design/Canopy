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
