-- 029: Remove email_key from families
-- Family identification now uses sender email via member_additional_emails,
-- not a unique per-family inbound address.

-- Update create_family to no longer generate or store email_key
DROP FUNCTION IF EXISTS create_family(text);
CREATE OR REPLACE FUNCTION create_family(member_display_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO families(id)
  VALUES (v_family_id);

  INSERT INTO family_members(family_id, user_id, role, display_name)
  VALUES (v_family_id, auth.uid(), 'parent_a', member_display_name);
END;
$$;

-- Update get_admin_families to remove email_key from return type and search
DROP FUNCTION IF EXISTS get_admin_families(text, integer, integer);
CREATE OR REPLACE FUNCTION get_admin_families(
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
         WHERE fm3.family_id = f.id
           AND fm3.display_name ILIKE '%' || p_search || '%'
       )
    GROUP BY f.id
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Drop the column
ALTER TABLE families DROP COLUMN IF EXISTS email_key;
