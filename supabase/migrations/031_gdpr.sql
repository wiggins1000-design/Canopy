-- ── GDPR / UK DPA compliance additions ───────────────────────────────────────

-- 1. Consent tracking on family_members
--    consents JSONB: { "medical_data": { "given": true, "at": "ISO" }, "familyfeed_ai": { ... } }
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS consents JSONB NOT NULL DEFAULT '{}';

-- 2. record_consent — called from the client when a user gives explicit consent
CREATE OR REPLACE FUNCTION public.record_consent(p_type text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE family_members
  SET consents = consents || jsonb_build_object(
    p_type,
    jsonb_build_object('given', true, 'at', now()::text)
  )
  WHERE user_id = auth.uid();
$$;

-- 3. delete_account_data — called from the delete-account edge function (service role)
--    Returns scope + family_id so the edge function can purge storage.
--    Two cases:
--      'family' — this was the last parent; entire family deleted (cascade handles rows)
--      'member' — other parent remains; only this user's membership removed
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id    uuid;
  v_parent_count int;
BEGIN
  -- Always remove user-specific rows first
  DELETE FROM member_additional_emails WHERE user_id = p_user_id;

  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = p_user_id;

  IF v_family_id IS NULL THEN
    RETURN jsonb_build_object('deleted', 'user_only');
  END IF;

  SELECT count(*) INTO v_parent_count
  FROM family_members
  WHERE family_id = v_family_id
    AND user_id  != p_user_id
    AND role IN ('parent_a', 'parent_b');

  IF v_parent_count = 0 THEN
    -- Last parent: delete the family; FK cascades handle all child rows
    DELETE FROM families WHERE id = v_family_id;
    RETURN jsonb_build_object('deleted', 'family', 'family_id', v_family_id);
  ELSE
    -- Other parent remains: remove only this user's membership
    DELETE FROM family_members WHERE user_id = p_user_id AND family_id = v_family_id;
    RETURN jsonb_build_object('deleted', 'member', 'family_id', v_family_id);
  END IF;
END;
$$;
