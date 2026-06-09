-- 020: Admin family detail RPC and member search

CREATE OR REPLACE FUNCTION get_admin_family_detail(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (SELECT 1 FROM admin_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'family', row_to_json(f.*),
    'members', (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',      fm.user_id,
        'role',         fm.role,
        'display_name', fm.display_name,
        'created_at',   fm.created_at,
        'email',        u.email,
        'push_token',   CASE WHEN fm.push_token IS NOT NULL THEN true ELSE false END
      ) ORDER BY fm.created_at)
      FROM family_members fm
      JOIN auth.users u ON u.id = fm.user_id
      WHERE fm.family_id = p_family_id
    ),
    'schedule', (
      SELECT row_to_json(bs.*)
      FROM baseline_schedules bs
      WHERE bs.family_id = p_family_id
      LIMIT 1
    ),
    'recent_posts', (
      SELECT jsonb_agg(jsonb_build_object(
        'id',         np.id,
        'content',    LEFT(np.content, 120),
        'tag',        np.tag,
        'author_id',  np.author_id,
        'created_at', np.created_at,
        'is_pinned',  np.is_pinned
      ) ORDER BY np.created_at DESC)
      FROM (
        SELECT * FROM notice_posts
        WHERE family_id = p_family_id AND is_archived = false
        ORDER BY created_at DESC LIMIT 10
      ) np
    ),
    'recent_events', (
      SELECT jsonb_agg(jsonb_build_object(
        'id',         fe.id,
        'title',      fe.title,
        'event_date', fe.event_date,
        'source',     fe.source,
        'created_at', fe.created_at
      ) ORDER BY fe.event_date DESC)
      FROM (
        SELECT * FROM family_events
        WHERE family_id = p_family_id
        ORDER BY event_date DESC LIMIT 10
      ) fe
    ),
    'stats', jsonb_build_object(
      'post_count',    (SELECT COUNT(*) FROM notice_posts WHERE family_id = p_family_id AND is_archived = false),
      'event_count',   (SELECT COUNT(*) FROM family_events WHERE family_id = p_family_id),
      'change_count',  (SELECT COUNT(*) FROM schedule_changes WHERE family_id = p_family_id),
      'holiday_count', (SELECT COUNT(*) FROM schedule_changes WHERE family_id = p_family_id AND is_holiday = true)
    )
  ) INTO v_result
  FROM families f
  WHERE f.id = p_family_id;

  RETURN v_result;
END;
$$;

-- Search members by email (admin only)
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
      'family_name',  f.name,
      'created_at',   u.created_at
    )
    FROM auth.users u
    JOIN family_members fm ON fm.user_id = u.id
    JOIN families f        ON f.id = fm.family_id
    WHERE LOWER(u.email) = LOWER(p_email)
    LIMIT 1
  );
END;
$$;
