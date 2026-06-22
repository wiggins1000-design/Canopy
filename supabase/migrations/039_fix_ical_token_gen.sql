-- Replace gen_random_bytes (pgcrypto, not enabled) with gen_random_uuid()
CREATE OR REPLACE FUNCTION get_or_create_ical_token()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_token     text;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT ical_token INTO v_token FROM families WHERE id = v_family_id;
  IF v_token IS NULL THEN
    -- Two UUIDs concatenated, dashes stripped = 64-char hex token
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    UPDATE families SET ical_token = v_token WHERE id = v_family_id;
  END IF;
  RETURN v_token;
END;
$$;
