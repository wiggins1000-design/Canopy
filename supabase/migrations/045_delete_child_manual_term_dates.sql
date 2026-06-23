-- 045: Update delete_child_and_data to surface manual term dates rather than
-- auto-deleting them. KB-imported dates (school_calendar_id IS NOT NULL) are
-- still removed automatically. Manual dates are left in place and their school
-- name + count are returned so the frontend can prompt the user.

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
  v_school_url          text;
  v_school_name         text;
  v_school_calendar_id  uuid;
  v_other_at_school     int;
  v_events_deleted      int;
  v_kb_term_dates_deleted int := 0;
  v_manual_term_count     int := 0;
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
  WHERE family_id       = p_family_id
    AND tagged_children @> ARRAY[p_child_name];

  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

  -- Find the child's school URL and name from info_bank
  SELECT data->>'school_url', data->>'school_name'
    INTO v_school_url, v_school_name
  FROM info_bank
  WHERE family_id  = p_family_id
    AND child_name = p_child_name
    AND section    = 'school'
  LIMIT 1;

  -- Resolve school_calendars ID via URL
  IF v_school_url IS NOT NULL AND v_school_url <> '' THEN
    SELECT id INTO v_school_calendar_id
    FROM school_calendars
    WHERE homepage_url = v_school_url
    LIMIT 1;
  END IF;

  IF v_school_calendar_id IS NOT NULL OR (v_school_name IS NOT NULL AND v_school_name <> '') THEN

    -- Check whether any OTHER child in this family attends the same school
    SELECT COUNT(*) INTO v_other_at_school
    FROM info_bank
    WHERE family_id  = p_family_id
      AND section    = 'school'
      AND child_name <> p_child_name
      AND (
        (v_school_url IS NOT NULL AND data->>'school_url' = v_school_url)
        OR data->>'school_name' = v_school_name
      );

    IF v_other_at_school = 0 THEN
      -- Auto-delete KB-imported term dates (reliable FK match)
      IF v_school_calendar_id IS NOT NULL THEN
        DELETE FROM family_events
        WHERE family_id         = p_family_id
          AND source            = 'term_dates'
          AND school_calendar_id = v_school_calendar_id;

        GET DIAGNOSTICS v_kb_term_dates_deleted = ROW_COUNT;
      END IF;

      -- Count manually-added term dates for this school (do NOT delete yet —
      -- return to frontend so the user can be prompted)
      IF v_school_name IS NOT NULL AND v_school_name <> '' THEN
        SELECT COUNT(*) INTO v_manual_term_count
        FROM family_events
        WHERE family_id        = p_family_id
          AND source           = 'term_dates'
          AND school_calendar_id IS NULL
          AND source_subject   = v_school_name;
      END IF;
    END IF;
  END IF;

  -- Delete all info_bank entries for this child
  DELETE FROM info_bank
  WHERE family_id  = p_family_id
    AND child_name = p_child_name;

  RETURN jsonb_build_object(
    'events_deleted',       v_events_deleted,
    'kb_term_dates_deleted', v_kb_term_dates_deleted,
    'manual_school_name',   CASE WHEN v_manual_term_count > 0 THEN v_school_name ELSE NULL END,
    'manual_term_count',    v_manual_term_count
  );
END;
$$;
