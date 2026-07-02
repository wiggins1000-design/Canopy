-- Returns the raw term_dates JSONB for one school, for the admin "view in calendar"
-- preview. Read-only, admin-only — does not touch family_events or school_calendars.
CREATE OR REPLACE FUNCTION public.get_admin_school_term_dates(p_school_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT term_dates INTO v_dates
  FROM public.school_calendars
  WHERE id = p_school_id;

  RETURN COALESCE(v_dates, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_school_term_dates(UUID) TO authenticated;
