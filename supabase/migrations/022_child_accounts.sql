-- 022: Child platform accounts (usernames/passwords stored with Supabase Vault encryption)

CREATE TABLE IF NOT EXISTS child_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       uuid        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_name      text        NOT NULL,
  platform        text        NOT NULL,
  username        text        NOT NULL DEFAULT '',
  url             text,
  notes           text,
  vault_secret_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE child_accounts ENABLE ROW LEVEL SECURITY;

-- All family members can read accounts
DROP POLICY IF EXISTS "Family members can view accounts" ON child_accounts;
CREATE POLICY "Family members can view accounts"
  ON child_accounts FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
  ));

-- ── add_child_account ─────────────────────────────────────────────────────────
-- Creates a vault secret for the password, inserts the account row.
CREATE OR REPLACE FUNCTION add_child_account(
  p_child_name text,
  p_platform   text,
  p_username   text,
  p_password   text  DEFAULT NULL,
  p_url        text  DEFAULT NULL,
  p_notes      text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id  uuid;
  v_secret_id  uuid;
  v_account_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    SELECT vault.create_secret(
      p_password,
      gen_random_uuid()::text,
      'canopy_account_password'
    ) INTO v_secret_id;
  END IF;

  INSERT INTO child_accounts(family_id, child_name, platform, username, url, notes, vault_secret_id)
  VALUES (v_family_id, p_child_name, p_platform, p_username, p_url, p_notes, v_secret_id)
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;

-- ── update_child_account ──────────────────────────────────────────────────────
-- Pass p_password = NULL to leave the existing password unchanged.
CREATE OR REPLACE FUNCTION update_child_account(
  p_id       uuid,
  p_platform text,
  p_username text,
  p_password text  DEFAULT NULL,
  p_url      text  DEFAULT NULL,
  p_notes    text  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id     uuid;
  v_old_secret_id uuid;
  v_new_secret_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_secret_id INTO v_old_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    -- Delete old vault secret and create a new one
    IF v_old_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_old_secret_id;
    END IF;
    SELECT vault.create_secret(p_password, gen_random_uuid()::text, 'canopy_account_password')
    INTO v_new_secret_id;
  ELSE
    v_new_secret_id := v_old_secret_id;
  END IF;

  UPDATE child_accounts
  SET platform        = p_platform,
      username        = p_username,
      url             = p_url,
      notes           = p_notes,
      vault_secret_id = v_new_secret_id,
      updated_at      = now()
  WHERE id = p_id AND family_id = v_family_id;
END;
$$;

-- ── delete_child_account ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_child_account(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_secret_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_secret_id INTO v_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  DELETE FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
END;
$$;

-- ── get_account_password ──────────────────────────────────────────────────────
-- Reads from vault.decrypted_secrets — only accessible server-side via this RPC.
-- Both parents and read-only members can reveal passwords.
CREATE OR REPLACE FUNCTION get_account_password(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_secret_id uuid;
  v_password  text;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid()
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_secret_id INTO v_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF v_secret_id IS NULL THEN RETURN NULL; END IF;

  SELECT decrypted_secret INTO v_password
  FROM vault.decrypted_secrets WHERE id = v_secret_id;

  RETURN v_password;
END;
$$;
