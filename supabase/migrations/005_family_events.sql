-- ============================================================
-- Canopy — family events (AI email parsing)
-- Run this in the Supabase SQL editor
-- ============================================================

-- Short unique email key per family (first 12 chars of UUID, no hyphens)
alter table public.families
  add column if not exists email_key text unique;

update public.families
  set email_key = lower(substring(replace(id::text, '-', ''), 1, 12))
  where email_key is null;

-- Family events — created manually or via AI email parsing
create table if not exists public.family_events (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  title          text not null,
  event_date     date not null,
  end_date       date,
  event_time     text,
  notes          text,
  source         text not null default 'manual'
                   check (source in ('manual', 'email_ai')),
  source_subject text,
  created_at     timestamptz not null default now()
);

alter table public.family_events enable row level security;

create policy "events_select" on public.family_events
  for select using (family_id = public.my_family_id());

create policy "events_delete" on public.family_events
  for delete using (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

-- RPC to insert a family event (security definer bypasses RLS)
create or replace function public.create_family_event(
  p_family_id      uuid,
  p_title          text,
  p_event_date     date,
  p_end_date       date    default null,
  p_event_time     text    default null,
  p_notes          text    default null,
  p_source         text    default 'manual',
  p_source_subject text    default null
)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into public.family_events
    (family_id, title, event_date, end_date, event_time, notes, source, source_subject)
  values
    (p_family_id, p_title, p_event_date, p_end_date, p_event_time, p_notes, p_source, p_source_subject)
  returning id into v_id;
  return v_id;
end;
$$;

-- Realtime for live updates when AI creates events
alter publication supabase_realtime add table public.family_events;
