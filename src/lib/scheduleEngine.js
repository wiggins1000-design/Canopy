// scheduleEngine — pure functions for custody schedule logic.
//
// A "schedule" is a row from baseline_schedules with a start_date and a
// pattern_data.cycle array (e.g. 14 entries for alternating weeks). Given any
// date, getBaselineOwner() walks the cycle from start_date to find the owner.
// getDayState() layers accepted changes and FROR offers on top to produce the
// final displayed state for each calendar day.
//
// All functions are pure (no side effects, no DB calls) so they can be called
// freely in useMemo/render without performance concerns.

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
  '2_2_3':           '2‑2‑3',
  '3_4_4_3':         '3‑4‑4‑3',
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
    case '2_2_3':
      // 14-day cycle: week 1 = 2A 2B 3A, week 2 flips = 2B 2A 3B
      return { cycle: [a,a,b,b,a,a,a, b,b,a,a,b,b,b] }
    case '3_4_4_3':
      // 14-day cycle: 3A 4B 4A 3B
      return { cycle: [...Array(3).fill(a), ...Array(4).fill(b), ...Array(4).fill(a), ...Array(3).fill(b)] }
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
 * Like getBaselineOwner, but picks the right pattern period for the date
 * instead of always using the current live schedule. A schedule change only
 * takes effect from its own start_date forward -- dates before that must
 * keep resolving against whatever pattern was actually in effect then,
 * which lives in `history` (baseline_schedule_history rows) once a change
 * has superseded it.
 *
 * @param {string} dateStr
 * @param {object} params
 * @param {object} params.schedule – the current live baseline_schedules row
 * @param {object[]} [params.history] – baseline_schedule_history rows, each
 *   with its own start_date/end_date/pattern_type/pattern_data/starting_parent
 */
export function getOwnerForDate(dateStr, { schedule, history = [] }) {
  if (schedule?.start_date && dateStr >= schedule.start_date) {
    return getBaselineOwner(schedule, dateStr)
  }
  const period = history.find((h) => h.start_date <= dateStr && dateStr <= h.end_date)
  if (period) return getBaselineOwner(period, dateStr)
  // No matching historical period and before the live schedule's start --
  // nothing applies to this date yet.
  return null
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
export function getDayState(dateStr, { schedule, changes = [], offers = [], history = [] }) {
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

  const baselineOwner = getOwnerForDate(dateStr, { schedule, history })

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

  // Declined FROR offer — show on the day for record
  const declinedOffer = offers.find(
    (o) => o.status === 'declined' && Array.isArray(o.dates) && o.dates.includes(dateStr),
  )
  if (declinedOffer) {
    return { owner: baselineOwner, type: 'offer_declined', change: pendingChange ?? null, offer: declinedOffer }
  }

  // Declined change request — show on the day for record
  const declinedChange = changes.find(
    (c) => c.status === 'declined' && c.start_date <= dateStr && dateStr <= c.end_date,
  )
  if (declinedChange) {
    return { owner: baselineOwner, type: 'change_declined', change: declinedChange, offer: null }
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
 * Returns day objects for a Monday-first calendar grid (5 or 6 rows as needed).
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
  const target = days.length <= 35 ? 35 : 42
  let pad = 1
  while (days.length < target) {
    days.push({ date: new Date(year, month + 1, pad++), current: false })
  }
  return days
}
