-- ============================================================
-- Canopy — admin locale filtering
-- ============================================================
-- 1. get_admin_families: add locale column + p_locale filter param
-- 2. admin_get_broadcast_recipients: add locale segments + fix
--    fm.email reference (column dropped in migration 029)

-- ── get_admin_families ────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_admin_families(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_admin_families(
  p_search text  DEFAULT NULL,
  p_limit  int   DEFAULT 50,
  p_offset int   DEFAULT 0,
  p_locale text  DEFAULT NULL   -- NULL = all locales
)
RETURNS TABLE (
  id           uuid,
  parent_names text,
  created_at   timestamptz,
  member_count bigint,
  has_schedule boolean,
  post_count   bigint,
  event_count  bigint,
  locale       text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
    SELECT
      f.id,
      (
        SELECT string_agg(fm2.display_name, ' & ' ORDER BY fm2.role)
        FROM public.family_members fm2
        WHERE fm2.family_id = f.id AND fm2.role IN ('parent_a', 'parent_b')
      ) AS parent_names,
      f.created_at,
      COUNT(DISTINCT fm.id)::bigint,
      EXISTS(SELECT 1 FROM public.baseline_schedules bs WHERE bs.family_id = f.id),
      COUNT(DISTINCT np.id)::bigint,
      COUNT(DISTINCT fe.id)::bigint,
      COALESCE(f.config->>'locale', 'en-GB') AS locale
    FROM public.families f
    LEFT JOIN public.family_members fm ON fm.family_id = f.id
    LEFT JOIN public.notice_posts   np ON np.family_id = f.id
    LEFT JOIN public.family_events  fe ON fe.family_id = f.id
    WHERE (p_locale IS NULL OR COALESCE(f.config->>'locale', 'en-GB') = p_locale)
      AND (p_search IS NULL
           OR EXISTS (
             SELECT 1 FROM public.family_members fm3
             JOIN auth.users u ON u.id = fm3.user_id
             WHERE fm3.family_id = f.id
               AND (fm3.display_name ILIKE '%' || p_search || '%'
                    OR u.email ILIKE '%' || p_search || '%')
           ))
    GROUP BY f.id
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_families(text, integer, integer, text) TO authenticated;

-- ── admin_get_broadcast_recipients ───────────────────────────────────────────
-- Replaces the 055 version which incorrectly referenced fm.email (dropped in 029).
-- Now joins auth.users for emails and supports locale_* segments.

DROP FUNCTION IF EXISTS public.admin_get_broadcast_recipients(text);

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_recipients(
  p_segment text DEFAULT 'all'
)
RETURNS TABLE(email text, display_name text, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
    SELECT
      u.email::text,
      fm.display_name,
      fm.family_id
    FROM public.family_members fm
    JOIN auth.users          u ON u.id    = fm.user_id
    JOIN public.families     f ON f.id    = fm.family_id
    WHERE fm.role IN ('parent_a', 'parent_b')
      AND u.email IS NOT NULL
      AND (
        p_segment = 'all'

        OR (p_segment = 'inactive_30'
            AND (u.last_sign_in_at IS NULL
                 OR u.last_sign_in_at < now() - interval '30 days'))

        -- locale_en-GB / locale_en-AU / locale_en-IE / locale_en-US
        -- prefix 'locale_' is 7 chars; substring(p_segment from 8) = 'en-GB' etc.
        OR (p_segment LIKE 'locale_%'
            AND COALESCE(f.config->>'locale', 'en-GB') = substring(p_segment from 8))
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_recipients(text) TO authenticated;
