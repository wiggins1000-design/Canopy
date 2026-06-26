-- ============================================================
-- Canopy — term dates scrape failure diagnostics
-- ============================================================
-- Adds three columns to school_calendars so the check-term-dates
-- edge function can record why a school failed to scrape, along
-- with a plain-English Claude-generated explanation.
-- Exposes an admin-only RPC so the admin UI can display these.

ALTER TABLE public.school_calendars
  ADD COLUMN IF NOT EXISTS scrape_error      JSONB,
  ADD COLUMN IF NOT EXISTS scrape_error_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scrape_diagnosis  TEXT;

-- ── Admin RPC ─────────────────────────────────────────────────
-- Returns all school_calendars rows with diagnostic info.
-- Failed schools sorted first, then by most recently fetched.
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
  scrape_diagnosis TEXT
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
    scrape_diagnosis
  FROM public.school_calendars
  ORDER BY
    CASE WHEN scrape_error IS NOT NULL THEN 0 ELSE 1 END,
    scrape_error_at  DESC NULLS LAST,
    last_fetched_at  DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_school_calendars() TO authenticated;
