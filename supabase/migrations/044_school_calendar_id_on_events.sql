-- 044: Add school_calendar_id to family_events
-- Allows term date rows imported from the KB to carry a reliable FK to the
-- school_calendars record, so child-deletion can match by ID rather than
-- relying on source_subject text matching exactly.
-- Photo, manual, and inspect-add paths leave this column NULL — they continue
-- to match by source_subject name when a child is removed.

ALTER TABLE public.family_events
  ADD COLUMN IF NOT EXISTS school_calendar_id uuid
    REFERENCES public.school_calendars(id) ON DELETE SET NULL;

-- Update create_family_event to accept the new optional parameter
CREATE OR REPLACE FUNCTION public.create_family_event(
  p_family_id         uuid,
  p_title             text,
  p_event_date        date,
  p_end_date          date    DEFAULT NULL,
  p_event_time        text    DEFAULT NULL,
  p_end_time          text    DEFAULT NULL,
  p_notes             text    DEFAULT NULL,
  p_source            text    DEFAULT 'manual',
  p_source_subject    text    DEFAULT NULL,
  p_recurrence        text    DEFAULT NULL,
  p_recurrence_end    date    DEFAULT NULL,
  p_tagged_children   text[]  DEFAULT NULL,
  p_school_calendar_id uuid   DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.family_events
    (family_id, title, event_date, end_date, event_time, end_time, notes,
     source, source_subject, recurrence, recurrence_end, tagged_children,
     school_calendar_id)
  VALUES
    (p_family_id, p_title, p_event_date, p_end_date, p_event_time, p_end_time, p_notes,
     p_source, p_source_subject, p_recurrence, p_recurrence_end, p_tagged_children,
     p_school_calendar_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Replace delete_child_and_data with URL/ID-aware version
-- Matches KB-imported term dates by school_calendar_id (exact FK),
-- and manually-added ones by source_subject name (fallback).
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
  v_term_dates_deleted  int := 0;
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

  -- Resolve the school_calendars ID via URL (most reliable path)
  IF v_school_url IS NOT NULL AND v_school_url <> '' THEN
    SELECT id INTO v_school_calendar_id
    FROM school_calendars
    WHERE homepage_url = v_school_url
    LIMIT 1;
  END IF;

  -- Proceed with term date cleanup only if we have something to match on
  IF v_school_calendar_id IS NOT NULL OR (v_school_name IS NOT NULL AND v_school_name <> '') THEN

    -- Check whether any OTHER child in this family attends the same school,
    -- matching by URL (reliable) or by school name (fallback)
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
      -- Delete KB-imported term dates matched by FK, plus any manually-added
      -- ones matched by source_subject name
      DELETE FROM family_events
      WHERE family_id = p_family_id
        AND source    = 'term_dates'
        AND (
          (v_school_calendar_id IS NOT NULL AND school_calendar_id = v_school_calendar_id)
          OR (school_calendar_id IS NULL AND source_subject = v_school_name)
        );

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
