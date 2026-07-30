// Canopy — Supabase Edge Function: send-evening-reminders
//
// Runs on a cron (every 15 minutes, all day) and, for each family whose
// configured reminder time falls in the current 15-minute window (in THEIR
// local timezone), sends a push notification to whichever parent has the
// children tonight, listing tomorrow's calendar events and PE/sport days.
//
// ── Mode ─────────────────────────────────────────────────────────────────────
//   Cron only: x-webhook-token header = DAILY_REMINDER_WEBHOOK_TOKEN
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   DAILY_REMINDER_WEBHOOK_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy send-evening-reminders --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Fallback only for families that predate timezone auto-capture (client sets
// family.config.timezone on first load after this feature shipped).
const LOCALE_TIMEZONE_FALLBACK: Record<string, string> = {
  'en-GB': 'Europe/London',
  'en-IE': 'Europe/Dublin',
  'en-AU': 'Australia/Sydney',
  'en-US': 'America/New_York',
}

// Ported, not shared, from src/lib/termDatesUtils.js's classifyTermEvent —
// Deno edge functions can't import the browser bundle. If that file's
// classification rules ever change, this copy needs updating too.
const INSET_RE = /\b(inset|baker\s+day|occasional\s+day|pd\s+day|professional\s+development|teacher\s+work\s?day|non.?student\s+day|records?\s+day|pupil.?free|student.?free|curriculum\s+day|school\s+development\s+day|staff\s+development|in.?service)\b/

function isClosureEvent(title: string, endDate: string | null): boolean {
  const lower = (title ?? '').toLowerCase()
  if (INSET_RE.test(lower)) return true
  if (endDate) return true
  return lower.includes('bank holiday') || lower.includes('closed')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const webhookToken  = Deno.env.get('DAILY_REMINDER_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  if (!webhookToken || incomingToken !== webhookToken) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const nowUtc = new Date()
  const { data: families } = await supabase.from('families').select('id, config')

  const results: any[] = []
  for (const family of families ?? []) {
    try {
      const result = await processFamily(family, nowUtc)
      if (result) results.push({ familyId: family.id, ...result })
    } catch (e: any) {
      console.error(`Family ${family.id} failed:`, e?.message)
      results.push({ familyId: family.id, error: e?.message })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function processFamily(family: { id: string; config: any }, nowUtc: Date) {
  const config = family.config ?? {}
  const timezone = config.timezone ?? LOCALE_TIMEZONE_FALLBACK[config.locale] ?? 'Europe/London'
  const reminderTime: string = config.evening_reminder_time ?? '20:00'

  const local = localDateTime(nowUtc, timezone)
  if (!local) return null

  const [targetH, targetM] = reminderTime.split(':').map(Number)
  if (Number.isNaN(targetH) || Number.isNaN(targetM)) return null
  const targetMinutes = targetH * 60 + targetM
  const nowMinutes    = local.hour * 60 + local.minute

  // Cron runs every 15 min — fire once, in the 15-min window starting at the target time.
  if (nowMinutes < targetMinutes || nowMinutes >= targetMinutes + 15) return { skipped: 'outside window' }
  if (config.last_evening_reminder_sent === local.dateStr) return { skipped: 'already sent today' }

  const tomorrowStr = addDays(local.dateStr, 1)

  const [
    { data: schedule },
    { data: changes },
    { data: offers },
    { data: events },
    { data: schoolRows },
    { data: termDatesTomorrow },
  ] = await Promise.all([
    supabase.from('baseline_schedules').select('*').eq('family_id', family.id).maybeSingle(),
    supabase.from('schedule_changes').select('*').eq('family_id', family.id),
    supabase.from('fror_offers').select('*').eq('family_id', family.id),
    supabase.from('family_events').select('title, event_time').eq('family_id', family.id).eq('event_date', tomorrowStr).order('event_time', { ascending: true, nullsFirst: false }),
    supabase.from('info_bank').select('child_name, data').eq('family_id', family.id).eq('section', 'school'),
    // Holidays/half-terms are multi-day (event_date..end_date) — need every
    // term_dates row that could still be spanning tomorrow, not just an exact
    // event_date match (that only ever caught a holiday's first day).
    supabase.from('family_events').select('title, event_date, end_date').eq('family_id', family.id).eq('source', 'term_dates').lte('event_date', tomorrowStr),
  ])

  // Who has the kids tonight (today's date) — they're the ones who need to know
  // what's happening tomorrow.
  const owner = getDayOwner(local.dateStr, schedule, changes ?? [], offers ?? [])
  if (!owner) return { skipped: 'no custody owner for tonight' }

  // PE days are a recurring weekday pattern — suppress if tomorrow is already a
  // school-closure day (holiday or INSET/PD/curriculum day etc.).
  const isHolidayTomorrow = (termDatesTomorrow ?? []).some((r: any) =>
    isClosureEvent(r.title, r.end_date) && tomorrowStr <= (r.end_date ?? r.event_date)
  )
  const tomorrowWeekday = new Date(`${tomorrowStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const peKids = isHolidayTomorrow ? [] : (schoolRows ?? [])
    .filter((r: any) => r.data?.pe_days?.includes(tomorrowWeekday))
    .map((r: any) => r.child_name)

  const lines: string[] = (events ?? []).map((e: any) => e.event_time ? `${e.title} (${e.event_time})` : e.title)
  if (peKids.length) lines.push(`PE — ${peKids.join(' & ')}`)

  if (lines.length === 0) {
    await markSent(family.id, config, local.dateStr)
    return { skipped: 'nothing tomorrow', owner }
  }

  const title = `Tomorrow (${tomorrowStr})`
  const body  = lines.join(', ')

  await supabase.functions.invoke('send-push', {
    body: { family_id: family.id, recipient_role: owner, title, body, url: '/calendar' },
  })
  await markSent(family.id, config, local.dateStr)

  return { sent: true, owner, body }
}

async function markSent(familyId: string, config: any, dateStr: string) {
  await supabase.from('families')
    .update({ config: { ...config, last_evening_reminder_sent: dateStr } })
    .eq('id', familyId)
}

// ── Date/timezone helpers ────────────────────────────────────────────────────

function localDateTime(date: Date, timeZone: string): { dateStr: string; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
    // "24" is midnight in some ICU formatters with hour12:false — normalise to "00".
    const hour = get('hour') === '24' ? 0 : parseInt(get('hour'))
    return {
      dateStr: `${get('year')}-${get('month')}-${get('day')}`,
      hour,
      minute: parseInt(get('minute')),
    }
  } catch {
    return null
  }
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().split('T')[0]
}

// ── Custody schedule — ported from src/lib/scheduleEngine.js ────────────────
// Keep in sync if that file's getBaselineOwner/getDayState logic changes.
// Only the *owner* determination is needed here (not the display-only "type"
// used for calendar strips), so declined changes/offers are omitted - they
// don't affect who actually has the children.

function parseDateLocal(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dayOffset(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

function getBaselineOwner(schedule: any, dateStr: string): string | null {
  if (!schedule?.start_date || !schedule?.pattern_data?.cycle?.length) return null
  const start  = parseDateLocal(schedule.start_date)
  const target = parseDateLocal(dateStr)
  const offset = dayOffset(start, target)
  if (offset < 0) return null
  const { cycle } = schedule.pattern_data
  return cycle[offset % cycle.length] ?? null
}

function getDayOwner(dateStr: string, schedule: any, changes: any[], offers: any[]): string | null {
  const acceptedChange = changes.find((c) => c.status === 'accepted' && c.start_date <= dateStr && dateStr <= c.end_date)
  if (acceptedChange) return acceptedChange.assigned_to

  const baselineOwner = getBaselineOwner(schedule, dateStr)

  const activeOffer = offers.find((o) => ['pending', 'accepted'].includes(o.status) && Array.isArray(o.dates) && o.dates.includes(dateStr))
  if (activeOffer) {
    if (activeOffer.status === 'accepted') {
      return activeOffer.offered_by_role === 'parent_a' ? 'parent_b' : 'parent_a'
    }
    return baselineOwner
  }

  return baselineOwner
}
