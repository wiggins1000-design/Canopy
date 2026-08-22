-- 091: Same propose/deadline/auto-apply pattern as 085 (baseline_schedules)
-- and 089 (viewer permissions), applied to a third feature requiring Parent
-- B's authorization that the earlier audit missed: ad-hoc schedule change
-- requests ("Request a change" on the Calendar).
--
-- Unlike the other two, schedule_changes is already one row per request
-- (not a single mutable row per family), so no pending_* shadow columns
-- are needed -- the row itself just gets a deadline, and its own status
-- transitions in place.
--
-- Previously: ScheduleChangePanel.jsx inserted directly via the client with
-- status='pending' unconditionally, even when there's no Parent B to ever
-- respond -- and once Parent B exists, a pending request had no deadline at
-- all, so it could sit forever. Also had no cancel path for the requester.

ALTER TABLE public.schedule_changes
  ADD COLUMN IF NOT EXISTS expires_at          timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_2d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_1d_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.request_schedule_change(
  p_start_date  date,
  p_end_date    date,
  p_assigned_to text,
  p_note        text,
  p_is_holiday  boolean DEFAULT false,
  p_start_time  time DEFAULT NULL,
  p_end_time    time DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family_id    uuid;
  v_has_parent_b boolean;
  v_id           uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM family_members WHERE family_id = v_family_id AND role = 'parent_b'
  ) INTO v_has_parent_b;

  INSERT INTO schedule_changes (
    family_id, requested_by, start_date, end_date,
    assigned_to, note, is_holiday, start_time, end_time,
    status, responded_at, expires_at
  ) VALUES (
    v_family_id, auth.uid(), p_start_date, p_end_date,
    p_assigned_to, p_note, p_is_holiday, p_start_time, p_end_time,
    CASE WHEN v_has_parent_b THEN 'pending'  ELSE 'accepted' END,
    CASE WHEN v_has_parent_b THEN NULL       ELSE now() END,
    CASE WHEN v_has_parent_b THEN now() + interval '7 days' ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Lets the requester delete their own request while it's still pending
-- (e.g. sent by mistake) -- there was previously no way to undo a request
-- at all, only accept/decline by the other parent.
CREATE OR REPLACE FUNCTION public.cancel_schedule_change_request(
  p_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM schedule_changes
  WHERE id = p_id AND requested_by = auth.uid() AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or no longer cancellable';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_schedule_change(date, date, text, text, boolean, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_change_request(uuid) TO authenticated;
