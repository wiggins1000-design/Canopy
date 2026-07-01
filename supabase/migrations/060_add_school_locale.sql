-- ============================================================
-- Canopy — add locale column to school_calendars
-- ============================================================
-- Stores the locale at scrape time so we don't have to infer
-- it from the URL TLD (which is ambiguous for US/some IE schools).

ALTER TABLE public.school_calendars
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-GB';

-- Backfill locale for existing schools from TLD
UPDATE public.school_calendars SET locale =
  CASE
    WHEN homepage_url ~* '\.(co\.uk|sch\.uk|ac\.uk|org\.uk)(/|$)'        THEN 'en-GB'
    WHEN homepage_url ~* '\.(com\.au|edu\.au|vic\.edu\.au|nsw\.edu\.au|qld\.edu\.au|eq\.edu\.au)(/|$)' THEN 'en-AU'
    WHEN homepage_url ~* '\.ie(/|$)'                                       THEN 'en-IE'
    ELSE 'en-GB'  -- existing KB is all UK schools; US schools not yet in KB
  END
WHERE locale = 'en-GB';

-- Update admin RPC to expose locale (drop first — return type changed)
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
  locale           TEXT
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
    locale
  FROM public.school_calendars
  ORDER BY
    CASE WHEN scrape_error IS NOT NULL THEN 0 ELSE 1 END,
    scrape_error_at  DESC NULLS LAST,
    last_fetched_at  DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_school_calendars() TO authenticated;
