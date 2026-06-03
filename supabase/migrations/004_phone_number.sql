-- ============================================================
-- Canopy — add phone_number to family_members
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.family_members
  add column if not exists phone_number text;
