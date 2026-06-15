-- Update delete_account_data to:
--   1. Cancel pending FROR offers from the deleted user
--   2. Cancel pending schedule proposal if it was from the deleted user
--   3. Return deleted parent's name + remaining parent role for notification

CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id             uuid;
  v_parent_count          int;
  v_deleted_name          text;
  v_remaining_parent_role text;
BEGIN
  DELETE FROM member_additional_emails WHERE user_id = p_user_id;

  SELECT family_id, display_name INTO v_family_id, v_deleted_name
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
    DELETE FROM families WHERE id = v_family_id;
    RETURN jsonb_build_object('deleted', 'family', 'family_id', v_family_id);
  ELSE
    SELECT role INTO v_remaining_parent_role
    FROM family_members
    WHERE family_id = v_family_id
      AND user_id  != p_user_id
      AND role IN ('parent_a', 'parent_b')
    LIMIT 1;

    -- Cancel any pending FROR offers from this user
    DELETE FROM fror_offers
    WHERE offered_by = p_user_id AND status = 'pending';

    -- Cancel pending schedule proposal if it was from this user
    UPDATE baseline_schedules
    SET
      pending_pattern_type    = NULL,
      pending_pattern_data    = NULL,
      pending_start_date      = NULL,
      pending_starting_parent = NULL,
      pending_proposed_by     = NULL,
      pending_proposed_at     = NULL
    WHERE family_id          = v_family_id
      AND pending_proposed_by = p_user_id;

    DELETE FROM family_members WHERE user_id = p_user_id AND family_id = v_family_id;

    RETURN jsonb_build_object(
      'deleted',                'member',
      'family_id',              v_family_id,
      'deleted_display_name',   v_deleted_name,
      'remaining_parent_role',  v_remaining_parent_role
    );
  END IF;
END;
$$;
