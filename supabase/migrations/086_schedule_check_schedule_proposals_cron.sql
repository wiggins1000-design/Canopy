-- Migration 086: Schedule the hourly check-schedule-proposals cron
--
-- BEFORE RUNNING: replace <SCHEDULE_PROPOSAL_WEBHOOK_TOKEN> below with the
-- real secret value (same one check-schedule-proposals already validates
-- against), then apply via a scratchpad copy per feedback_secret_handling
-- (never commit the real token).

SELECT cron.schedule(
  'check-schedule-proposals-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-schedule-proposals',
    headers := '{"Content-Type":"application/json","x-webhook-token":"<SCHEDULE_PROPOSAL_WEBHOOK_TOKEN>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
