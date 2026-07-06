-- Migration 071: Drop the unscoped family_invites UPDATE policy
--
-- "invites_update_join" (added in 001_initial_schema.sql) allowed any
-- authenticated session to mark ANY family's unused invite as used, with no
-- ownership check at all — (NOT used) AND (expires_at > now()), nothing
-- scoping it to the caller's own family. Confirmed dead: join_family() (added
-- migration 048) is SECURITY DEFINER and marks invites used atomically,
-- bypassing RLS entirely, so no client code needs or uses this policy — a
-- repo-wide search found zero direct .update('family_invites') calls.
--
-- Found 2026-07-06 while reviewing RLS exposure before enabling anonymous
-- sign-ins for the parenting plan tool's payment flow (shared Supabase
-- project) — this gap pre-dates that change and would have applied to any
-- real signed-up user too, not just anonymous sessions.

DROP POLICY IF EXISTS "invites_update_join" ON public.family_invites;
