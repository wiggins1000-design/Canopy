-- 082: Fix account deletion being blocked by non-cascading auth.users FKs,
-- while preserving shared family content (notices/messages/etc.) when a
-- member deletes their account or leaves the family.
--
-- Two parts:
--   1. Snapshot the author's ROLE (not name — GDPR erasure means their name
--      shouldn't persist after deletion) onto notice_posts/messages/
--      schedule_changes at insert time, via trigger. UI falls back to
--      "Parent A" / "Parent B" / "External" once the live family_members
--      row is gone (it's always deleted on account removal already).
--   2. Change every other non-cascading auth.users FK to ON DELETE SET NULL
--      (relaxing NOT NULL where needed) so deleting a user no longer fails
--      outright for anyone who has ever posted/messaged/uploaded/requested
--      anything — which today is nearly every real member.

-- ── Part 1: role snapshot columns + triggers ────────────────────────────────

ALTER TABLE notice_posts     ADD COLUMN IF NOT EXISTS author_role    text;
ALTER TABLE messages         ADD COLUMN IF NOT EXISTS sender_role    text;
ALTER TABLE schedule_changes ADD COLUMN IF NOT EXISTS requester_role text;

CREATE OR REPLACE FUNCTION set_notice_post_author_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_role IS NULL AND NEW.author_id IS NOT NULL THEN
    SELECT role INTO NEW.author_role
    FROM family_members
    WHERE user_id = NEW.author_id AND family_id = NEW.family_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notice_post_author_role ON notice_posts;
CREATE TRIGGER trg_notice_post_author_role
  BEFORE INSERT ON notice_posts
  FOR EACH ROW EXECUTE FUNCTION set_notice_post_author_role();

CREATE OR REPLACE FUNCTION set_message_sender_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_role IS NULL AND NEW.sender_id IS NOT NULL THEN
    SELECT role INTO NEW.sender_role
    FROM family_members
    WHERE user_id = NEW.sender_id AND family_id = NEW.family_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_sender_role ON messages;
CREATE TRIGGER trg_message_sender_role
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION set_message_sender_role();

CREATE OR REPLACE FUNCTION set_schedule_change_requester_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requester_role IS NULL AND NEW.requested_by IS NOT NULL THEN
    SELECT role INTO NEW.requester_role
    FROM family_members
    WHERE user_id = NEW.requested_by AND family_id = NEW.family_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_change_requester_role ON schedule_changes;
CREATE TRIGGER trg_schedule_change_requester_role
  BEFORE INSERT ON schedule_changes
  FOR EACH ROW EXECUTE FUNCTION set_schedule_change_requester_role();

-- Backfill role for existing rows where the author/sender/requester is
-- still a family member (best-effort — can't recover it for anyone who's
-- already been deleted, since the role information no longer exists).
UPDATE notice_posts np SET author_role = fm.role
  FROM family_members fm
  WHERE fm.user_id = np.author_id AND fm.family_id = np.family_id AND np.author_role IS NULL;

UPDATE messages m SET sender_role = fm.role
  FROM family_members fm
  WHERE fm.user_id = m.sender_id AND fm.family_id = m.family_id AND m.sender_role IS NULL;

UPDATE schedule_changes sc SET requester_role = fm.role
  FROM family_members fm
  WHERE fm.user_id = sc.requested_by AND fm.family_id = sc.family_id AND sc.requester_role IS NULL;

-- ── Part 2: unblock account deletion — ON DELETE SET NULL everywhere ────────

ALTER TABLE notice_posts DROP CONSTRAINT notice_posts_author_id_fkey;
ALTER TABLE notice_posts ADD CONSTRAINT notice_posts_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE message_threads ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE message_threads DROP CONSTRAINT message_threads_created_by_fkey;
ALTER TABLE message_threads ADD CONSTRAINT message_threads_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE schedule_changes ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE schedule_changes DROP CONSTRAINT schedule_changes_requested_by_fkey;
ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE vault_documents DROP CONSTRAINT vault_documents_uploaded_by_fkey;
ALTER TABLE vault_documents ADD CONSTRAINT vault_documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE family_invites DROP CONSTRAINT family_invites_used_by_fkey;
ALTER TABLE family_invites ADD CONSTRAINT family_invites_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE fror_offers ALTER COLUMN offered_by DROP NOT NULL;
ALTER TABLE fror_offers DROP CONSTRAINT fror_offers_offered_by_fkey;
ALTER TABLE fror_offers ADD CONSTRAINT fror_offers_offered_by_fkey
  FOREIGN KEY (offered_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Parenting Plan tool tables (parentingplan.help — shares this Supabase
-- project/auth). Same FK-blocks-deletion problem for collaborators who
-- aren't the plan's own creator (pp_plans.created_by already cascades).
ALTER TABLE pp_amendments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE pp_amendments DROP CONSTRAINT pp_amendments_created_by_fkey;
ALTER TABLE pp_amendments ADD CONSTRAINT pp_amendments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE pp_amendments DROP CONSTRAINT pp_amendments_resolved_by_fkey;
ALTER TABLE pp_amendments ADD CONSTRAINT pp_amendments_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE pp_analyses ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE pp_analyses DROP CONSTRAINT pp_analyses_requested_by_fkey;
ALTER TABLE pp_analyses ADD CONSTRAINT pp_analyses_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE pp_versions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE pp_versions DROP CONSTRAINT pp_versions_created_by_fkey;
ALTER TABLE pp_versions ADD CONSTRAINT pp_versions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
