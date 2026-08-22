-- Migration 092: Schedule the hourly check-schedule-change-requests cron
--
-- BEFORE RUNNING: replace <SCHEDULE_CHANGE_REQUEST_WEBHOOK_TOKEN> below with
-- the real secret value (same one check-schedule-change-requests already
-- validates against), then apply via a scratchpad copy per
-- feedback_secret_handling (never commit the real token).

SELECT cron.schedule(
  'check-schedule-change-requests-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-schedule-change-requests',
    headers := '{"Content-Type":"application/json","x-webhook-token":"<SCHEDULE_CHANGE_REQUEST_WEBHOOK_TOKEN>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
