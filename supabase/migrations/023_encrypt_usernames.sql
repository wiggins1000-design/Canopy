-- 023: Move child account usernames into Supabase Vault (encryption at rest)
-- Previously only passwords were vaulted; usernames were stored as plaintext.

-- 1. Add column to hold the vault secret ID for the username
ALTER TABLE child_accounts ADD COLUMN IF NOT EXISTS vault_username_id uuid;

-- 2. Migrate existing plaintext usernames → Vault, then clear the plaintext column
DO $$
DECLARE
  r record;
  v_secret_id uuid;
BEGIN
  FOR r IN
    SELECT id, username
    FROM child_accounts
    WHERE username IS NOT NULL AND username <> '' AND vault_username_id IS NULL
  LOOP
    SELECT vault.create_secret(r.username, gen_random_uuid()::text, 'canopy_account_username')
    INTO v_secret_id;
    UPDATE child_accounts SET vault_username_id = v_secret_id, username = '' WHERE id = r.id;
  END LOOP;
END;
$$;

-- 3. Update add_child_account — vault the username as well as the password
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
  v_family_id          uuid;
  v_username_secret_id uuid;
  v_secret_id          uuid;
  v_account_id         uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF p_username IS NOT NULL AND p_username <> '' THEN
    SELECT vault.create_secret(p_username, gen_random_uuid()::text, 'canopy_account_username')
    INTO v_username_secret_id;
  END IF;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    SELECT vault.create_secret(p_password, gen_random_uuid()::text, 'canopy_account_password')
    INTO v_secret_id;
  END IF;

  INSERT INTO child_accounts(family_id, child_name, platform, username, url, notes, vault_secret_id, vault_username_id)
  VALUES (v_family_id, p_child_name, p_platform, '', p_url, p_notes, v_secret_id, v_username_secret_id)
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;

-- 4. Update update_child_account — blank username means keep existing (same as password)
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
  v_family_id              uuid;
  v_old_secret_id          uuid;
  v_old_username_secret_id uuid;
  v_new_secret_id          uuid;
  v_new_username_secret_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_secret_id, vault_username_id
  INTO v_old_secret_id, v_old_username_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF p_username IS NOT NULL AND p_username <> '' THEN
    IF v_old_username_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_old_username_secret_id;
    END IF;
    SELECT vault.create_secret(p_username, gen_random_uuid()::text, 'canopy_account_username')
    INTO v_new_username_secret_id;
  ELSE
    v_new_username_secret_id := v_old_username_secret_id;
  END IF;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    IF v_old_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_old_secret_id;
    END IF;
    SELECT vault.create_secret(p_password, gen_random_uuid()::text, 'canopy_account_password')
    INTO v_new_secret_id;
  ELSE
    v_new_secret_id := v_old_secret_id;
  END IF;

  UPDATE child_accounts
  SET platform          = p_platform,
      username          = '',
      url               = p_url,
      notes             = p_notes,
      vault_secret_id   = v_new_secret_id,
      vault_username_id = v_new_username_secret_id,
      updated_at        = now()
  WHERE id = p_id AND family_id = v_family_id;
END;
$$;

-- 5. Update delete_child_account — clean up both vault secrets
CREATE OR REPLACE FUNCTION delete_child_account(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id          uuid;
  v_secret_id          uuid;
  v_username_secret_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_secret_id, vault_username_id
  INTO v_secret_id, v_username_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;
  IF v_username_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_username_secret_id;
  END IF;

  DELETE FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
END;
$$;

-- 6. Add get_account_username — mirrors get_account_password
CREATE OR REPLACE FUNCTION get_account_username(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_secret_id uuid;
  v_username  text;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid()
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT vault_username_id INTO v_secret_id
  FROM child_accounts WHERE id = p_id AND family_id = v_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;

  IF v_secret_id IS NULL THEN RETURN ''; END IF;

  SELECT decrypted_secret INTO v_username
  FROM vault.decrypted_secrets WHERE id = v_secret_id;

  RETURN v_username;
END;
$$;
