-- ============================================================
-- Canopy — FamilyFeed email processing log + admin diagnostics
-- ============================================================
-- Logs every inbound email process-email handles (success, error, or
-- skipped), so FamilyFeed can be monitored from /admin the same way
-- check-term-dates is monitored via school_calendars' scrape_error/
-- scrape_diagnosis columns. Unlike term dates (one row per school,
-- upserted in place), email processing is a stream of discrete events
-- — one row per email — so this is a real log table, not a status
-- column on an existing row.
--
-- Retains 90 days of history via a daily pg_cron cleanup job; email
-- subjects can reference family/child names, so this isn't kept
-- indefinitely.

CREATE TABLE public.email_processing_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID REFERENCES public.families(id) ON DELETE SET NULL,
  from_email       TEXT NOT NULL,
  subject          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped_consent', 'skipped_unrecognised')),
  events_created   INT NOT NULL DEFAULT 0,
  events_updated   INT NOT NULL DEFAULT 0,
  events_skipped   INT NOT NULL DEFAULT 0,
  docs_saved       INT NOT NULL DEFAULT 0,
  notice_created   BOOLEAN NOT NULL DEFAULT false,
  error_stage      TEXT,
  error_message    TEXT,
  diagnosis        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_processing_log_family_id_idx  ON public.email_processing_log(family_id);
CREATE INDEX email_processing_log_created_at_idx ON public.email_processing_log(created_at DESC);
CREATE INDEX email_processing_log_status_idx     ON public.email_processing_log(status);

-- RLS on, but no client policies at all — this table is only ever written by
-- process-email (service role, bypasses RLS) and read via the admin RPCs below.
ALTER TABLE public.email_processing_log ENABLE ROW LEVEL SECURITY;

-- ── Admin RPC: recent log rows ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_email_processing_log(p_limit INT DEFAULT 200)
RETURNS TABLE (
  id              UUID,
  family_id       UUID,
  family_name     TEXT,
  from_email      TEXT,
  subject         TEXT,
  status          TEXT,
  events_created  INT,
  events_updated  INT,
  events_skipped  INT,
  docs_saved      INT,
  notice_created  BOOLEAN,
  error_stage     TEXT,
  error_message   TEXT,
  diagnosis       TEXT,
  created_at      TIMESTAMPTZ
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
      l.events_created, l.events_updated, l.events_skipped, l.docs_saved, l.notice_created,
      l.error_stage, l.error_message, l.diagnosis, l.created_at
    FROM public.email_processing_log l
    LEFT JOIN public.families f ON f.id = l.family_id
    ORDER BY l.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_email_processing_log(INT) TO authenticated;

-- ── Admin RPC: summary stats (last 30 days) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_email_processing_stats()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN (
    SELECT json_build_object(
      'total_30d',   count(*),
      'success_30d', count(*) FILTER (WHERE status = 'success'),
      'error_30d',   count(*) FILTER (WHERE status = 'error'),
      'skipped_30d', count(*) FILTER (WHERE status IN ('skipped_consent', 'skipped_unrecognised'))
    )
    FROM public.email_processing_log
    WHERE created_at > now() - interval '30 days'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_email_processing_stats() TO authenticated;

-- ── Retention: keep 90 days of log history ──────────────────────
SELECT cron.schedule(
  'cleanup-email-processing-log',
  '0 3 * * *',
  $$ DELETE FROM public.email_processing_log WHERE created_at < now() - interval '90 days'; $$
);
