-- ============================================================
-- Canopy — shared school term dates cache
-- ============================================================

-- Shared cache of term dates keyed by school homepage URL.
-- One row per school, shared across all families using that school.
create table public.school_calendars (
  id               uuid primary key default gen_random_uuid(),
  homepage_url     text not null,
  term_dates_url   text,
  school_name      text,
  term_dates       jsonb not null default '[]',
  content_hash     text,
  last_fetched_at  timestamptz,
  created_at       timestamptz not null default now()
);

create unique index school_calendars_homepage_url_idx
  on public.school_calendars (homepage_url);

alter table public.school_calendars enable row level security;

-- Any authenticated user can read (to show last_fetched_at in UI)
create policy "school_calendars_select" on public.school_calendars
  for select to authenticated using (true);

-- Only service role (edge function) can write — no insert/update policy for authenticated

-- Add 'term_dates' as a valid source on family_events
alter table public.family_events
  drop constraint if exists family_events_source_check;

alter table public.family_events
  add constraint family_events_source_check
  check (source in ('manual', 'email_ai', 'term_dates'));

-- ── Cron setup ───────────────────────────────────────────────
-- Set up a monthly cron job in the Supabase dashboard:
--   Dashboard → Database → Cron Jobs → New cron job
--   Schedule: 0 3 1 * *  (3am on the 1st of every month)
--   Function: check-term-dates
--   Or via SQL (requires pg_net + your TERM_DATES_WEBHOOK_TOKEN secret):
--
-- select cron.schedule(
--   'check-term-dates-monthly',
--   '0 3 1 * *',
--   $$
--   select net.http_post(
--     url := 'https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-term-dates',
--     headers := '{"Content-Type":"application/json","x-webhook-token":"YOUR_TOKEN"}'::jsonb,
--     body := '{}'::jsonb
--   )
--   $$
-- );
