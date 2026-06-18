-- 036: RPC to retag generic term_date events by matching date+title against KB data.
-- Replaces the ID-based approach in 035, which was limited to events loaded
-- in the client's date window. This covers the full history.

CREATE OR REPLACE FUNCTION public.retag_term_dates(
  p_family_id    uuid,
  p_school_label text,
  p_pairs        jsonb  -- [{"date": "2025-10-27", "title": "Autumn Half Term"}, ...]
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.family_events fe
  SET    source_subject = p_school_label
  WHERE  fe.family_id = p_family_id
    AND  fe.source    = 'term_dates'
    AND  (fe.source_subject IS NULL OR fe.source_subject = 'School term dates')
    AND  EXISTS (
      SELECT 1
      FROM   jsonb_array_elements(p_pairs) AS p
      WHERE  (p->>'date')::date = fe.event_date
        AND   p->>'title'       = fe.title
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
