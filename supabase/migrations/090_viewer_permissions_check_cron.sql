-- Migration 090: Schedule the hourly check-viewer-permission-proposals cron
--
-- BEFORE RUNNING: replace <VIEWER_PERMISSIONS_WEBHOOK_TOKEN> below with the
-- real secret value (same one check-viewer-permission-proposals already
-- validates against), then apply via a scratchpad copy per
-- feedback_secret_handling (never commit the real token).

SELECT cron.schedule(
  'check-viewer-permission-proposals-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-viewer-permission-proposals',
    headers := '{"Content-Type":"application/json","x-webhook-token":"<VIEWER_PERMISSIONS_WEBHOOK_TOKEN>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
