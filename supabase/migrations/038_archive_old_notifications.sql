-- Auto-archive system notification posts older than 30 days.
-- Called by the check-term-dates edge function in monthly cron mode.
-- Only archives tag='notification' posts; parent-authored posts are never touched.
CREATE OR REPLACE FUNCTION archive_old_notifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE notice_posts
  SET    is_archived = true
  WHERE  tag         = 'notification'
    AND  is_archived = false
    AND  is_pinned   = false
    AND  created_at  < NOW() - INTERVAL '30 days';
$$;
