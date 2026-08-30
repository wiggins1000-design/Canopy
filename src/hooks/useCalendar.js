// useCalendar — builds the full calendar grid for the displayed month.
//
// Each day object combines three layers of state via getDayState():
//   1. Baseline schedule (repeating cycle from baseline_schedules table)
//   2. Accepted/pending schedule changes (override or flag the baseline)
//   3. FROR (first right of refusal) offers (further override when accepted)
// Realtime channels keep changes and offers live for both parents simultaneously.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { getDayState, getCalendarMonthDays, formatDate } from '../lib/scheduleEngine'

export function useCalendar() {
  const { family, schedule, scheduleHistory } = useFamily()

  const [viewDate, setViewDate] = useState(() => new Date())
  const [changes, setChanges] = useState([])
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(true)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const loadMonth = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)

    const monthStart = formatDate(new Date(year, month, 1))
    const monthEnd = formatDate(new Date(year, month + 1, 0))

    const [{ data: changesData }, { data: offersData }] = await Promise.all([
      supabase
        .from('schedule_changes')
        .select('*')
        .eq('family_id', family.id)
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart),
      supabase
        .from('fror_offers')
        .select('*')
        .eq('family_id', family.id)
        .neq('status', 'expired'),
    ])

    setChanges(changesData ?? [])
    setOffers(offersData ?? [])
    setLoading(false)
  }, [family?.id, year, month])

  useEffect(() => {
    loadMonth()
  }, [loadMonth])

  // Realtime updates
  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`calendar-${family.id}-${year}-${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_changes', filter: `family_id=eq.${family.id}` }, loadMonth)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fror_offers', filter: `family_id=eq.${family.id}` }, loadMonth)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, year, month, loadMonth])

  // A native app merely backgrounded (not force-quit) keeps its whole JS
  // context alive, including this stale in-memory `changes` state -- and the
  // realtime websocket above routinely gets suspended by the OS while
  // backgrounded, silently missing updates (e.g. a schedule-change auto-apply
  // that fired hours later) with no automatic backfill on reconnect. Refetch
  // on resume/foreground so returning to the app never shows stale state.
  useEffect(() => {
    if (!family?.id) return
    let resumeHandle
    ;(async () => {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) return
      const { App } = await import('@capacitor/app')
      resumeHandle = await App.addListener('resume', loadMonth)
    })()
    const onVisible = () => { if (document.visibilityState === 'visible') loadMonth() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { resumeHandle?.remove(); document.removeEventListener('visibilitychange', onVisible) }
  }, [family?.id, loadMonth])

  const calendarDays = useMemo(() => {
    const config = family?.config ?? {}
    const defaultTime = config.changeover_time ?? null
    const defaultLocation = config.changeover_location ?? null
    const overrides = config.changeover_overrides ?? {}

    return getCalendarMonthDays(year, month).map(({ date, current }) => {
      const dateStr = formatDate(date)
      const state = getDayState(dateStr, { schedule, changes, offers, history: scheduleHistory })

      const prevDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)
      const prevState = getDayState(formatDate(prevDate), { schedule, changes, offers, history: scheduleHistory })
      const isTransition = current && state.owner !== null && prevState.owner !== null && state.owner !== prevState.owner

      const changeoverTime = isTransition ? (overrides[dateStr]?.time ?? defaultTime) : null
      const changeoverLocation = isTransition ? (overrides[dateStr]?.location ?? defaultLocation) : null

      return { date, dateStr, current, ...state, isTransition, changeoverTime, changeoverLocation }
    })
  }, [year, month, schedule, scheduleHistory, changes, offers, family?.config])

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1))
  }

  return { calendarDays, viewDate, prevMonth, nextMonth, loading, refetch: loadMonth }
}
