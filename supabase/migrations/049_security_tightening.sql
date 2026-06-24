-- ============================================================
-- Canopy — security tightening
-- 1. Narrow invites_select: drop the OR true that let any
--    authenticated user read all family invite codes.
--    join_family() is now an RPC so the client never needs
--    to read family_invites directly for joining.
-- 2. Pin search_path on my_family_id / my_family_role — these
--    power every RLS policy so search-path injection here
--    would bypass all row-level security.
-- ============================================================

-- ── 1. Tighten invites_select ─────────────────────────────────

DROP POLICY IF EXISTS "invites_select" ON public.family_invites;

CREATE POLICY "invites_select" ON public.family_invites
  FOR SELECT USING (family_id = public.my_family_id());

-- ── 2. Pin search_path on RLS helper functions ────────────────

CREATE OR REPLACE FUNCTION public.my_family_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT family_id FROM public.family_members WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.my_family_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.family_members WHERE user_id = auth.uid() LIMIT 1;
$$;
