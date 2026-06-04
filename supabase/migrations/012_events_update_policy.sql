-- ============================================================
-- Canopy — allow parents to update family events
-- Run this in the Supabase SQL editor
-- ============================================================

create policy "events_update" on public.family_events
  for update using (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );
