-- ============================================================
-- Canopy — info bank (per-child and family-wide reference data)
-- Run this in the Supabase SQL editor
-- ============================================================

create table public.info_bank (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  child_name text not null,   -- child name from config, or 'family' for shared entries
  section    text not null,   -- 'medical' | 'school' | 'contacts' | 'personal'
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (family_id, child_name, section)
);

alter table public.info_bank enable row level security;

create policy "info_bank_select" on public.info_bank
  for select using (family_id = public.my_family_id());

create policy "info_bank_insert" on public.info_bank
  for insert with check (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

create policy "info_bank_update" on public.info_bank
  for update using (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

create policy "info_bank_delete" on public.info_bank
  for delete using (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );
