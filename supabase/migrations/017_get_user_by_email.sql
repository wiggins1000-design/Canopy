-- ============================================================
-- Canopy — look up auth user ID by email (used by process-email edge function)
-- security definer allows access to auth.users without admin client
-- Run this in the Supabase SQL editor
-- ============================================================

create or replace function public.get_user_id_by_email(p_email text)
returns uuid language sql security definer as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
