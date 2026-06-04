-- ============================================================
-- Canopy — additional forwarding email addresses per user
-- Allows parents to forward emails from secondary accounts
-- Run this in the Supabase SQL editor
-- ============================================================

create table public.member_additional_emails (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  unique (email)
);

alter table public.member_additional_emails enable row level security;

create policy "additional_emails_select" on public.member_additional_emails
  for select using (user_id = auth.uid());

create policy "additional_emails_insert" on public.member_additional_emails
  for insert with check (user_id = auth.uid());

create policy "additional_emails_delete" on public.member_additional_emails
  for delete using (user_id = auth.uid());
