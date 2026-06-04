-- ============================================================
-- Canopy — add start_time and end_time to fror_offers
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.fror_offers
  add column if not exists start_time time,
  add column if not exists end_time   time;
