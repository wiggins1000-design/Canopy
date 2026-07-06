-- Migration 072: Allow pp_collaborators.invited_email to be NULL
--
-- pp_save_plan() fetches the owner's email from auth.users to store as
-- invited_email, but anonymous users (see the 2026-07-06 anonymous-auth
-- payment flow) have no email at all until they upgrade via updateUser().
-- The NOT NULL constraint made every pp_save_plan() call fail with a 400
-- for anonymous owners. The UNIQUE (plan_id, invited_email) constraint is
-- unaffected - Postgres treats multiple NULLs as distinct, and there's only
-- ever one owner row per plan anyway.
--
-- Known follow-up (not done here): once an anonymous owner upgrades to a
-- real email via updateUser(), nothing currently backfills invited_email on
-- their existing pp_collaborators row - it stays NULL indefinitely.

ALTER TABLE public.pp_collaborators ALTER COLUMN invited_email DROP NOT NULL;
