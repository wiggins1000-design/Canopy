-- Migration 070: Schedule the monthly check-term-dates cron
-- Confirmed with Chris 2026-07-06 — this writes term-date events to real
-- family calendars going forward. The staleness/cost fix from 2026-07-03
-- (60-day staleness + unchanged-hash short-circuit) is already deployed,
-- so this should not trigger a full re-scrape/re-extraction of every school
-- every month, only ones that are actually due.
--
-- BEFORE RUNNING: replace <TERM_DATES_WEBHOOK_TOKEN> below with the real
-- secret value (same one check-term-dates already validates against),
-- then apply with:
--   .\scripts\deploy-migration.ps1 070_schedule_term_dates_cron.sql

SELECT cron.schedule(
  'check-term-dates-monthly',
  '0 3 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-term-dates',
    headers := '{"Content-Type":"application/json","x-webhook-token":"<TERM_DATES_WEBHOOK_TOKEN>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
