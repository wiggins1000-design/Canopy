// ── Date utilities ────────────────────────────────────────────

/** Parse a YYYY-MM-DD string as a local-time Date (no timezone shift). */
export function parseDate(str) {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format a Date as YYYY-MM-DD using local time. */
export function formatDate(date) {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Integer number of days from `from` to `to` (UTC-safe). */
function dayOffset(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

// ── Pattern builders ──────────────────────────────────────────

const OTHER = (p) => (p === 'parent_a' ? 'parent_b' : 'parent_a')

export const PATTERN_LABELS = {
  alternating_weeks: 'Alternating weeks (7–7)',
  '2_2_5_5':         '2‑2‑5‑5',
  custom:            'Custom',
}

/**
 * Build the cycle array for a named preset.
 * Returns { cycle: string[] }  where each entry is 'parent_a' | 'parent_b'.
 */
export function buildPresetPattern(patternType, startingParent) {
  const a = startingParent
  const b = OTHER(a)
  switch (patternType) {
    case 'alternating_weeks':
      return { cycle: [...Array(7).fill(a), ...Array(7).fill(b)] }
    case '2_2_5_5':
      return { cycle: [...Array(2).fill(a), ...Array(2).fill(b), ...Array(5).fill(a), ...Array(5).fill(b)] }
    default:
      return null
  }
}

// ── Core schedule engine ──────────────────────────────────────

/**
 * Returns 'parent_a' | 'parent_b' | null for a given date against the baseline.
 * @param {object} schedule  – row from baseline_schedules
 * @param {Date|string} date – Date object or YYYY-MM-DD string
 */
export function getBaselineOwner(schedule, date) {
  if (!schedule?.start_date || !schedule?.pattern_data?.cycle?.length) return null
  const start = parseDate(schedule.start_date)
  const target = date instanceof Date ? date : parseDate(date)
  const offset = dayOffset(start, target)
  if (offset < 0) return null
  const { cycle } = schedule.pattern_data
  return cycle[offset % cycle.length] ?? null
}

/**
 * Full day state — layers changes and FROR offers on top of the baseline.
 *
 * @returns {{
 *   owner:        'parent_a'|'parent_b'|null,
 *   type:         'baseline'|'change_pending'|'change_accepted'|'offered'|'offer_accepted',
 *   change:       object|null,
 *   offer:        object|null,
 * }}
 */
export function getDayState(dateStr, { schedule, changes = [], offers = [] }) {
  // 1. Accepted schedule change overrides everything
  const acceptedChange = changes.find(
    (c) => c.status === 'accepted' && c.start_date <= dateStr && dateStr <= c.end_date,
  )
  if (acceptedChange) {
    return { owner: acceptedChange.assigned_to, type: 'change_accepted', change: acceptedChange, offer: null }
  }

  // 2. Pending schedule change (doesn't change owner, just flags the day)
  const pendingChange = changes.find(
    (c) => c.status === 'pending' && c.start_date <= dateStr && dateStr <= c.end_date,
  )

  const baselineOwner = getBaselineOwner(schedule, dateStr)

  // 3. Active FROR offer (pending or accepted)
  const activeOffer = offers.find(
    (o) => ['pending', 'accepted'].includes(o.status) && Array.isArray(o.dates) && o.dates.includes(dateStr),
  )

  if (activeOffer) {
    const offeredByRole = activeOffer.offered_by_role
    const recipientRole = OTHER(offeredByRole)
    return {
      owner: activeOffer.status === 'accepted' ? recipientRole : baselineOwner,
      type: activeOffer.status === 'accepted' ? 'offer_accepted' : 'offered',
      change: pendingChange ?? null,
      offer: activeOffer,
    }
  }

  return {
    owner: baselineOwner,
    type: pendingChange ? 'change_pending' : 'baseline',
    change: pendingChange ?? null,
    offer: null,
  }
}

// ── Calendar grid ─────────────────────────────────────────────

/**
 * Returns 42 day objects for a 6-row, Monday-first calendar grid.
 * Each: { date: Date, current: boolean }
 */
export function getCalendarMonthDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  // Monday = 0
  const startDow = (firstDay.getDay() + 6) % 7
  const days = []

  for (let i = startDow - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), current: false })
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), current: true })
  }
  let pad = 1
  while (days.length < 42) {
    days.push({ date: new Date(year, month + 1, pad++), current: false })
  }
  return days
}
