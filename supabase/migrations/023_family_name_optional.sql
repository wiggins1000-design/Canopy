-- 023: Remove families.name column entirely

-- Drop the column
ALTER TABLE families DROP COLUMN IF EXISTS name;

-- Recreate create_family without the family_name parameter.
-- The old function (family_name text, member_display_name text) is dropped first
-- to avoid a signature conflict.
DROP FUNCTION IF EXISTS create_family(text, text);

CREATE OR REPLACE FUNCTION create_family(member_display_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO families(id, email_key)
  VALUES (v_family_id, lower(substring(replace(v_family_id::text, '-', ''), 1, 12)));

  INSERT INTO family_members(family_id, user_id, role, display_name)
  VALUES (v_family_id, auth.uid(), 'parent_a', member_display_name);
END;
$$;

-- Recreate get_admin_families: replace name with parent_names, update search
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
  email_key    text,
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
      f.email_key,
      COUNT(DISTINCT fm.id)::bigint,
      EXISTS(SELECT 1 FROM public.baseline_schedules bs WHERE bs.family_id = f.id),
      COUNT(DISTINCT np.id)::bigint,
      COUNT(DISTINCT fe.id)::bigint
    FROM public.families f
    LEFT JOIN public.family_members fm ON fm.family_id = f.id
    LEFT JOIN public.notice_posts   np ON np.family_id = f.id
    LEFT JOIN public.family_events  fe ON fe.family_id = f.id
    WHERE p_search IS NULL
       OR f.email_key ILIKE '%' || p_search || '%'
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

-- Remove family_name from get_admin_member_by_email result
CREATE OR REPLACE FUNCTION get_admin_member_by_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'user_id',      u.id,
      'email',        u.email,
      'display_name', fm.display_name,
      'role',         fm.role,
      'family_id',    fm.family_id,
      'created_at',   u.created_at
    )
    FROM auth.users u
    JOIN family_members fm ON fm.user_id = u.id
    WHERE LOWER(u.email) = LOWER(p_email)
    LIMIT 1
  );
END;
$$;
