-- Migration 067: surface candidate-event counts on the FamilyFeed admin log
-- ============================================================
-- Found via a real incident 2026-07-04: a Sway fetch returned suspiciously
-- thin content and Stage A extraction silently produced one fake placeholder
-- event instead of the ~13 real ones, but email_processing_log showed nothing
-- distinguishable from "genuinely no events in this email" — required manually
-- inspecting familyfeed_content_cache to diagnose. This column makes that
-- visible directly on /admin/familyfeed.

ALTER TABLE public.email_processing_log
  ADD COLUMN IF NOT EXISTS candidate_events_count INT NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.get_admin_email_processing_log(INT);

CREATE FUNCTION public.get_admin_email_processing_log(p_limit INT DEFAULT 200)
RETURNS TABLE (
  id               UUID,
  family_id        UUID,
  family_name      TEXT,
  from_email       TEXT,
  subject          TEXT,
  status           TEXT,
  events_created   INT,
  events_updated   INT,
  events_skipped   INT,
  candidate_events_count INT,
  docs_saved       INT,
  notice_created   BOOLEAN,
  error_stage      TEXT,
  error_message    TEXT,
  diagnosis        TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
    SELECT
      l.id, l.family_id,
      COALESCE(f.name, 'Family ' || substr(l.family_id::text, 1, 8)),
      l.from_email, l.subject, l.status,
      l.events_created, l.events_updated, l.events_skipped, l.candidate_events_count,
      l.docs_saved, l.notice_created,
      l.error_stage, l.error_message, l.diagnosis, l.created_at
    FROM public.email_processing_log l
    LEFT JOIN public.families f ON f.id = l.family_id
    ORDER BY l.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_email_processing_log(INT) TO authenticated;
