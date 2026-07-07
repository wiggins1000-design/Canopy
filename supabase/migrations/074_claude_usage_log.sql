-- ============================================================
-- Canopy — Claude API usage/cost log + admin diagnostics
-- ============================================================
-- Logs every Claude API call across all edge functions, tagged by
-- category, so /admin can show cost broken down by feature (term dates
-- vs FamilyFeed vs others) instead of one lump sum on the Anthropic
-- Console. Cost is computed at write time from a hardcoded per-model
-- price table in the shared logging helper (supabase/functions/_shared/
-- claudeUsage.ts) — Haiku 4.5 is the only model in use as of 2026-07-07
-- ($1/$5 per MTok input/output). Update that table if pricing changes
-- or a new model is introduced; historical rows keep their computed
-- cost_usd regardless (not recalculated retroactively).

CREATE TABLE public.claude_usage_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category       TEXT NOT NULL CHECK (category IN (
                   'term_dates', 'familyfeed', 'plan_review',
                   'event_extraction', 'admin_tools', 'other'
                 )),
  edge_function  TEXT NOT NULL,
  family_id      UUID REFERENCES public.families(id) ON DELETE SET NULL,
  model          TEXT NOT NULL,
  input_tokens   INT NOT NULL DEFAULT 0,
  output_tokens  INT NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX claude_usage_log_category_created_idx ON public.claude_usage_log(category, created_at DESC);
CREATE INDEX claude_usage_log_created_at_idx        ON public.claude_usage_log(created_at DESC);

-- RLS on, no client policies — only written by edge functions (service
-- role, bypasses RLS) and read via the admin RPC below.
ALTER TABLE public.claude_usage_log ENABLE ROW LEVEL SECURITY;

-- ── Admin RPC: cost summary by category over a given window ────────
CREATE OR REPLACE FUNCTION public.get_admin_claude_costs(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN (
    SELECT json_build_object(
      'window_days', p_days,
      'total_cost_usd', COALESCE(sum(cost_usd), 0),
      'total_calls', count(*),
      'by_category', (
        SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.cost_usd DESC), '[]'::json)
        FROM (
          SELECT
            category,
            count(*) AS calls,
            sum(input_tokens)  AS input_tokens,
            sum(output_tokens) AS output_tokens,
            sum(cost_usd)      AS cost_usd
          FROM public.claude_usage_log
          WHERE created_at > now() - (p_days || ' days')::interval
          GROUP BY category
        ) c
      ),
      'daily', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
        FROM (
          SELECT
            date_trunc('day', created_at)::date AS day,
            category,
            sum(cost_usd) AS cost_usd
          FROM public.claude_usage_log
          WHERE created_at > now() - (p_days || ' days')::interval
          GROUP BY 1, 2
        ) d
      )
    )
    FROM public.claude_usage_log
    WHERE created_at > now() - (p_days || ' days')::interval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_claude_costs(INT) TO authenticated;

-- ── Retention: keep 180 days of log history (no personal data beyond
--    an optional family_id FK, so a longer window than email/term-dates
--    logs is fine — this is for cost trend analysis, not diagnostics) ──
SELECT cron.schedule(
  'cleanup-claude-usage-log',
  '30 3 * * *',
  $$ DELETE FROM public.claude_usage_log WHERE created_at < now() - interval '180 days'; $$
);
