-- ============================================================
-- Canopy — fix get_admin_families broken by migration 054
-- ============================================================
-- Migration 054 reintroduced f.name and f.email_key references
-- that were dropped in 023 and 029 respectively, causing the
-- function to error at runtime and return no rows.
-- This restores the correct version and adds proper email search
-- via auth.users (not a non-existent family_members.email column).

DROP FUNCTION IF EXISTS public.get_admin_families(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_admin_families(
  p_search text  DEFAULT NULL,
  p_limit  int   DEFAULT 50,
  p_offset int   DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  parent_names text,
  created_at   timestamptz,
  member_count bigint,
  has_schedule boolean,
  post_count   bigint,
  event_count  bigint
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
      COUNT(DISTINCT fe.id)::bigint
    FROM public.families f
    LEFT JOIN public.family_members fm ON fm.family_id = f.id
    LEFT JOIN public.notice_posts   np ON np.family_id = f.id
    LEFT JOIN public.family_events  fe ON fe.family_id = f.id
    WHERE p_search IS NULL
       OR EXISTS (
         SELECT 1 FROM public.family_members fm3
         JOIN auth.users u ON u.id = fm3.user_id
         WHERE fm3.family_id = f.id
           AND (
             fm3.display_name ILIKE '%' || p_search || '%'
             OR u.email        ILIKE '%' || p_search || '%'
           )
       )
    GROUP BY f.id
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_families(text, integer, integer) TO authenticated;
