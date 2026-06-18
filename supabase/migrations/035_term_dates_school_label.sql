-- 035: RPC to retag existing term_date events with the proper school name.
-- Called by importFromKB when dates already exist with the generic
-- 'School term dates' source_subject (set by manual/photo import).

CREATE OR REPLACE FUNCTION public.update_term_date_school(
  p_family_id    uuid,
  p_event_ids    uuid[],
  p_school_label text
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.family_events
  SET    source_subject = p_school_label
  WHERE  family_id   = p_family_id
    AND  id          = ANY(p_event_ids)
    AND  source      = 'term_dates'
    AND  (source_subject IS NULL OR source_subject = 'School term dates');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
