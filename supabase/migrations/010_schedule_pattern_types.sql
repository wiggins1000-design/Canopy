-- ============================================================
-- Canopy — expand pattern_type check constraint to include all 5 patterns
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.baseline_schedules
  drop constraint if exists baseline_schedules_pattern_type_check;

alter table public.baseline_schedules
  add constraint baseline_schedules_pattern_type_check
  check (pattern_type in ('alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom'));
