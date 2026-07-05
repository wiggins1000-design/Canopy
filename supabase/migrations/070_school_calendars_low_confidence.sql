-- 070: Flag term-dates results that fell back to a below-plausibility-threshold result
-- (fewer than 5 dates, or no Christmas/New Year coverage) instead of being rejected
-- outright, so the admin panel and family-facing sync UI can surface them distinctly
-- from a confident result.
ALTER TABLE public.school_calendars
  ADD COLUMN IF NOT EXISTS low_confidence boolean NOT NULL DEFAULT false;

-- Expose it via the admin RPC (drop first — return type changed, matches the pattern
-- migration 060 used when it added the locale column)
DROP FUNCTION IF EXISTS public.get_admin_school_calendars();
CREATE OR REPLACE FUNCTION public.get_admin_school_calendars()
RETURNS TABLE (
  id               UUID,
  homepage_url     TEXT,
  school_name      TEXT,
  term_dates_url   TEXT,
  last_fetched_at  TIMESTAMPTZ,
  term_dates_count INT,
  scrape_error     JSONB,
  scrape_error_at  TIMESTAMPTZ,
  scrape_diagnosis TEXT,
  locale           TEXT,
  low_confidence   BOOLEAN
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    homepage_url,
    school_name,
    term_dates_url,
    last_fetched_at,
    jsonb_array_length(COALESCE(term_dates, '[]'::jsonb)) AS term_dates_count,
    scrape_error,
    scrape_error_at,
    scrape_diagnosis,
    locale,
    low_confidence
  FROM public.school_calendars
  ORDER BY
    CASE WHEN scrape_error IS NOT NULL THEN 0 ELSE 1 END,
    low_confidence   DESC,
    scrape_error_at  DESC NULLS LAST,
    last_fetched_at  DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_school_calendars() TO authenticated;
