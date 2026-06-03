-- ============================================================
-- Canopy — initial schema
-- ============================================================

-- ── families ────────────────────────────────────────────────
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  config      jsonb not null default '{"fror_expiry_hours": 48, "fror_reminder_hours": 24}',
  created_at  timestamptz not null default now()
);

-- ── family_members ───────────────────────────────────────────
create table public.family_members (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('parent_a', 'parent_b', 'third_party')),
  display_name  text not null,
  color         text,                   -- hex override; defaults handled client-side
  push_token    text,                   -- web-push subscription JSON
  created_at    timestamptz not null default now(),
  unique (family_id, user_id),
  -- enforce at most one parent_a and one parent_b per family
  unique (family_id, role) -- only enforced for non-third_party via trigger below
);

-- ── family_invites ───────────────────────────────────────────
create table public.family_invites (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  code        text not null unique default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  role        text not null check (role in ('parent_b', 'third_party')),
  used        boolean not null default false,
  used_by     uuid references auth.users(id),
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);

-- ── baseline_schedules ───────────────────────────────────────
-- One active schedule per family. Update in-place from Config page.
create table public.baseline_schedules (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade unique,
  pattern_type     text not null check (pattern_type in ('alternating_weeks', '2_2_5_5', 'custom')),
  -- pattern_data.cycle is an ordered array of 'parent_a'|'parent_b' strings
  -- e.g. alternating weeks: ["parent_a","parent_a",...7 times...,"parent_b",...7 times]
  pattern_data     jsonb not null,
  start_date       date not null,
  starting_parent  text not null check (starting_parent in ('parent_a', 'parent_b')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── schedule_changes ─────────────────────────────────────────
create table public.schedule_changes (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  start_date    date not null,
  end_date      date not null,
  assigned_to   text not null check (assigned_to in ('parent_a', 'parent_b')),
  note          text not null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ── fror_offers ──────────────────────────────────────────────
create table public.fror_offers (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,
  offered_by       uuid not null references auth.users(id),
  offered_by_role  text not null check (offered_by_role in ('parent_a', 'parent_b')),
  -- Array of ISO date strings e.g. ["2024-06-01","2024-06-02"]
  dates            text[] not null,
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at       timestamptz not null,
  reminder_sent    boolean not null default false,
  responded_at     timestamptz,
  created_at       timestamptz not null default now()
);

-- ── Row-Level Security ───────────────────────────────────────

alter table public.families         enable row level security;
alter table public.family_members   enable row level security;
alter table public.family_invites   enable row level security;
alter table public.baseline_schedules enable row level security;
alter table public.schedule_changes enable row level security;
alter table public.fror_offers      enable row level security;

-- Helper: get the family_id for the current authenticated user
create or replace function public.my_family_id()
returns uuid language sql stable security definer as $$
  select family_id from public.family_members where user_id = auth.uid() limit 1;
$$;

-- Helper: get the role for the current authenticated user
create or replace function public.my_family_role()
returns text language sql stable security definer as $$
  select role from public.family_members where user_id = auth.uid() limit 1;
$$;

-- ── families policies ────────────────────────────────────────
create policy "families_select" on public.families
  for select using (id = public.my_family_id());

create policy "families_insert" on public.families
  for insert with check (true); -- any authenticated user can create a family (onboarding)

create policy "families_update" on public.families
  for update using (id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

-- ── family_members policies ──────────────────────────────────
create policy "members_select" on public.family_members
  for select using (family_id = public.my_family_id());

create policy "members_insert" on public.family_members
  for insert with check (true); -- onboarding inserts own record

create policy "members_update_own" on public.family_members
  for update using (user_id = auth.uid()); -- can update own record (push token etc.)

-- ── family_invites policies ──────────────────────────────────
create policy "invites_select" on public.family_invites
  for select using (family_id = public.my_family_id() or true); -- joiners need to read before they have a family

create policy "invites_insert" on public.family_invites
  for insert with check (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

create policy "invites_update_join" on public.family_invites
  for update using (not used and expires_at > now());

-- ── baseline_schedules policies ──────────────────────────────
create policy "schedule_select" on public.baseline_schedules
  for select using (family_id = public.my_family_id());

create policy "schedule_insert" on public.baseline_schedules
  for insert with check (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

create policy "schedule_update" on public.baseline_schedules
  for update using (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

-- ── schedule_changes policies ─────────────────────────────────
create policy "changes_select" on public.schedule_changes
  for select using (family_id = public.my_family_id());

create policy "changes_insert" on public.schedule_changes
  for insert with check (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

create policy "changes_update_respond" on public.schedule_changes
  for update using (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

-- ── fror_offers policies ─────────────────────────────────────
create policy "offers_select" on public.fror_offers
  for select using (family_id = public.my_family_id());

create policy "offers_insert" on public.fror_offers
  for insert with check (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

create policy "offers_update_respond" on public.fror_offers
  for update using (family_id = public.my_family_id() and public.my_family_role() in ('parent_a', 'parent_b'));

-- ── Realtime ─────────────────────────────────────────────────
alter publication supabase_realtime add table public.schedule_changes;
alter publication supabase_realtime add table public.fror_offers;
alter publication supabase_realtime add table public.baseline_schedules;
