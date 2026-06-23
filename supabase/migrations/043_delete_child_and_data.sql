-- 043: delete_child_and_data RPC
-- Called when a parent removes a child from the family.
-- Deletes: calendar events tagged to that child, all info_bank entries for
-- that child, and term dates for their school — but only if no other child
-- in the family attends the same school.
-- Does NOT touch school_calendars (the shared knowledge base).

CREATE OR REPLACE FUNCTION public.delete_child_and_data(
  p_family_id  uuid,
  p_child_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_name        text;
  v_other_at_school    int;
  v_events_deleted     int;
  v_term_dates_deleted int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_id = p_family_id
      AND user_id   = auth.uid()
      AND role IN ('parent_a', 'parent_b')
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Delete calendar events tagged to this child (by name)
  DELETE FROM family_events
  WHERE family_id      = p_family_id
    AND tagged_children @> ARRAY[p_child_name];

  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

  -- Find the child's school from info_bank
  SELECT data->>'school_name' INTO v_school_name
  FROM info_bank
  WHERE family_id  = p_family_id
    AND child_name = p_child_name
    AND section    = 'school'
  LIMIT 1;

  IF v_school_name IS NOT NULL AND v_school_name <> '' THEN
    -- Count other children in this family at the same school
    SELECT COUNT(*) INTO v_other_at_school
    FROM info_bank
    WHERE family_id  = p_family_id
      AND section    = 'school'
      AND child_name <> p_child_name
      AND data->>'school_name' = v_school_name;

    IF v_other_at_school = 0 THEN
      DELETE FROM family_events
      WHERE family_id      = p_family_id
        AND source         = 'term_dates'
        AND source_subject = v_school_name;

      GET DIAGNOSTICS v_term_dates_deleted = ROW_COUNT;
    END IF;
  END IF;

  -- Delete all info_bank entries for this child
  DELETE FROM info_bank
  WHERE family_id  = p_family_id
    AND child_name = p_child_name;

  RETURN jsonb_build_object(
    'events_deleted',     v_events_deleted,
    'term_dates_deleted', v_term_dates_deleted,
    'school_name',        v_school_name
  );
END;
$$;
