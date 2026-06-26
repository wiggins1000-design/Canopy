-- Removes term date events older than 6 months from school_calendars.term_dates.
-- Called by the check-term-dates edge function on each cron run.
-- Family events already applied to family_events are unaffected.
CREATE OR REPLACE FUNCTION public.trim_old_term_dates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff DATE := (CURRENT_DATE - INTERVAL '6 months')::DATE;
BEGIN
  UPDATE public.school_calendars
  SET term_dates = (
    SELECT COALESCE(jsonb_agg(event), '[]'::jsonb)
    FROM jsonb_array_elements(term_dates) AS event
    -- Keep if the event end date (or start date for single-day events) is within the window
    WHERE COALESCE((event->>'end_date')::DATE, (event->>'date')::DATE) >= cutoff
  )
  WHERE term_dates IS NOT NULL
    AND jsonb_array_length(term_dates) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trim_old_term_dates() TO service_role;
