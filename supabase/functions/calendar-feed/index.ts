// Canopy — Supabase Edge Function: calendar-feed
//
// Generates an iCal (.ics) feed for a family's calendar.
// URL: /functions/v1/calendar-feed?token=TOKEN&types=schedule,events,term_dates,schedule_changes
//
// The token is a family's ical_token — stored in the families table and only
// visible to parents. Anyone with the URL can subscribe; to revoke access,
// regenerate the token via the settings page.
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy calendar-feed --no-verify-jwt --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')
  const types  = new Set((url.searchParams.get('types') ?? 'schedule,events,term_dates,schedule_changes').split(','))

  if (!token) {
    return new Response('Missing token', { status: 400, headers: CORS })
  }

  // Look up family by token
  const { data: family, error: familyErr } = await supabase
    .from('families')
    .select('id, config')
    .eq('ical_token', token)
    .maybeSingle()

  if (!family) {
    return new Response('Invalid token', { status: 401, headers: CORS })
  }

  const familyId = family.id
  const events: ICalEvent[] = []

  // ── Schedule events ──────────────────────────────────────────────────────
  if (types.has('schedule')) {
    const { data: schedule } = await supabase
      .from('baseline_schedules')
      .select('*')
      .eq('family_id', familyId)
      .single()

    if (schedule) {
      const { data: members } = await supabase
        .from('family_members')
        .select('user_id, role, display_name')
        .eq('family_id', familyId)

      const paName = members?.find(m => m.role === 'parent_a')?.display_name ?? 'Parent A'
      const pbName = members?.find(m => m.role === 'parent_b')?.display_name ?? 'Parent B'

      // Generate schedule days for the next 6 months
      const cycle: string[] = schedule.pattern_data?.cycle ?? []
      if (cycle.length > 0) {
        const start = new Date(schedule.start_date)
        const end   = new Date()
        end.setMonth(end.getMonth() + 6)

        let d = new Date(start)
        let dayIndex = 0
        while (d <= end) {
          const owner  = cycle[dayIndex % cycle.length]
          const name   = owner === 'parent_a' ? paName : pbName
          const dateStr = formatDate(d)
          events.push({
            uid:     `canopy-schedule-${familyId}-${dateStr}`,
            summary: `With ${name}`,
            dtstart: dateStr,
            dtend:   formatDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)),
            allDay:  true,
            color:   'green',
          })
          d.setDate(d.getDate() + 1)
          dayIndex++
        }
      }
    }
  }

  // ── Family events ────────────────────────────────────────────────────────
  if (types.has('events')) {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 1)

    const { data: familyEvents } = await supabase
      .from('family_events')
      .select('*')
      .eq('family_id', familyId)
      .neq('source', 'term_dates')
      .gte('event_date', cutoff.toISOString().split('T')[0])
      .order('event_date')

    for (const ev of familyEvents ?? []) {
      events.push({
        uid:         `canopy-event-${ev.id}`,
        summary:     ev.title,
        dtstart:     ev.event_date + (ev.event_time ? `T${ev.event_time.replace(':', '')}00` : ''),
        dtend:       ev.end_date ?? ev.event_date,
        allDay:      !ev.event_time,
        description: ev.notes ?? undefined,
        color:       'sky blue',
      })
    }
  }

  // ── Term dates ───────────────────────────────────────────────────────────
  if (types.has('term_dates')) {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 1)

    const { data: termEvents } = await supabase
      .from('family_events')
      .select('*')
      .eq('family_id', familyId)
      .eq('source', 'term_dates')
      .gte('event_date', cutoff.toISOString().split('T')[0])
      .order('event_date')

    for (const ev of termEvents ?? []) {
      events.push({
        uid:     `canopy-term-${ev.id}`,
        summary: `🏫 ${ev.title}`,
        dtstart: ev.event_date,
        dtend:   ev.end_date ?? ev.event_date,
        allDay:  true,
        color:   'teal',
      })
    }
  }

  // ── Schedule changes ─────────────────────────────────────────────────────
  if (types.has('schedule_changes')) {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 1)

    const { data: changes } = await supabase
      .from('schedule_changes')
      .select('*')
      .eq('family_id', familyId)
      .eq('status', 'approved')
      .gte('start_date', cutoff.toISOString().split('T')[0])
      .order('start_date')

    for (const ch of changes ?? []) {
      const prefix = ch.is_holiday ? '🏖️ Holiday' : '🔄 Change'
      events.push({
        uid:         `canopy-change-${ch.id}`,
        summary:     `${prefix}: ${ch.note ?? 'Schedule change'}`,
        dtstart:     ch.start_date,
        dtend:       ch.end_date ?? ch.start_date,
        allDay:      true,
        description: ch.note ?? undefined,
        color:       'orange',
      })
    }
  }

  // ── Build iCal ───────────────────────────────────────────────────────────
  const ical = buildICal(events, 'Canopy')

  return new Response(ical, {
    headers: {
      ...CORS,
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="CanopyCalendar.ics"',
      'Cache-Control':       'no-cache, no-store',
    },
  })
})

// ── iCal builder ─────────────────────────────────────────────────────────────

interface ICalEvent {
  uid:          string
  summary:      string
  dtstart:      string
  dtend:        string
  allDay:       boolean
  description?: string
  color?:       string
}

function buildICal(events: ICalEvent[], calName: string): string {
  const now   = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Canopy//Canopy Family Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
    'X-WR-CALDESC:Your family calendar from Canopy',
    'X-WR-TIMEZONE:Europe/London',
    'X-APPLE-CALENDAR-COLOR:#1b4332',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ]

  for (const ev of events) {
    const dtstart = ev.allDay
      ? `DTSTART;VALUE=DATE:${ev.dtstart.replace(/-/g, '').slice(0, 8)}`
      : `DTSTART:${ev.dtstart.replace(/-/g, '')}`
    // RFC 5545: all-day DTEND is exclusive (day after last day)
    const dtendDate = ev.allDay ? addDay(ev.dtend) : ev.dtend
    const dtend   = ev.allDay
      ? `DTEND;VALUE=DATE:${dtendDate.replace(/-/g, '').slice(0, 8)}`
      : `DTEND:${dtendDate.replace(/-/g, '')}`

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.uid}@canopy.app`)
    lines.push(`DTSTAMP:${now}`)
    lines.push(dtstart)
    lines.push(dtend)
    lines.push(`SUMMARY:${escapeText(ev.summary)}`)
    if (ev.color)       lines.push(`COLOR:${ev.color}`)
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`))
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function foldLine(line: string): string {
  // iCal lines must be <= 75 octets; fold longer lines
  if (line.length <= 75) return line
  const chunks: string[] = []
  chunks.push(line.slice(0, 75))
  let i = 75
  while (i < line.length) {
    chunks.push(' ' + line.slice(i, i + 74))
    i += 74
  }
  return chunks.join('\r\n')
}

function addDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return formatDate(d)
}

function formatDate(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
