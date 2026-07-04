-- Migration 066: FamilyFeed content-extraction cache
-- ============================================================
-- Many families forward the exact same content (a school-wide newsletter,
-- the same PDF, the same Sway link) to FamilyFeed. Extracting raw dated
-- events from a document is the expensive part (large document → Claude);
-- deciding which of those events matter to one family, and tagging/dedup
-- against that family's own calendar, is cheap (small structured list →
-- Claude). This table caches the expensive step by content hash, so a
-- second family forwarding identical content skips straight to the cheap
-- per-family step.
--
-- Retention: rows not reused in 30 days are purged by a daily pg_cron job,
-- so this doesn't grow unbounded. Content that changes (a school updates
-- the same newsletter page) naturally gets a new hash and doesn't hit a
-- stale cache entry — the TTL is purely storage housekeeping, not a
-- correctness mechanism.

CREATE TABLE public.familyfeed_content_cache (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash   TEXT NOT NULL UNIQUE,
  source_type    TEXT NOT NULL CHECK (source_type IN ('pdf', 'jsrendered_page', 'plain_page', 'docx', 'doc', 'html')),
  source_label   TEXT,
  raw_events     JSONB NOT NULL,
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count      INT NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX familyfeed_content_cache_hash_idx ON public.familyfeed_content_cache(content_hash);
CREATE INDEX familyfeed_content_cache_last_used_idx ON public.familyfeed_content_cache(last_used_at);

-- RLS on, no client policies — service role only (edge function reads/writes directly).
ALTER TABLE public.familyfeed_content_cache ENABLE ROW LEVEL SECURITY;

-- ── Retention: purge cache entries unused for 30+ days ──────────────────────
SELECT cron.schedule(
  'cleanup-familyfeed-content-cache',
  '30 3 * * *',
  $$ DELETE FROM public.familyfeed_content_cache WHERE last_used_at < now() - interval '30 days'; $$
);
