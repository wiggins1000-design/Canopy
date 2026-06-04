-- ============================================================
-- Canopy — enable REPLICA IDENTITY FULL on family_events
-- Required for Supabase realtime to fire on DELETE events
-- when using a filter (family_id=eq.X)
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.family_events replica identity full;
