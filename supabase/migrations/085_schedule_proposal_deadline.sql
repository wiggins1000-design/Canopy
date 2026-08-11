-- 085: Schedule proposal deadline + bypass when Parent B hasn't joined yet
--
-- Two fixes to the schedule-change-approval flow (026_schedule_proposal.sql):
--
-- 1. If Parent B has never joined the family (no family_members row with
--    role='parent_b' -- that row only ever gets created by join_family(),
--    so its existence already *is* "accepted their invite", no new signal
--    needed), a proposal could never be resolved: respond_to_schedule_proposal
--    can only be called by an existing parent_a/parent_b member, and Parent
--    A's own UI only offers "Cancel", never "apply directly". Fixed by having
--    propose_schedule_change apply immediately in this case, skipping the
--    pending_* columns entirely.
-- 2. Once Parent B exists, a pending proposal had no deadline. Adds
--    pending_expires_at (7 days out) plus two reminder-sent markers, so a
--    cron job (check-schedule-proposals edge function) can send reminder
--    emails and auto-apply if nothing happens in time.

ALTER TABLE public.baseline_schedules
  ADD COLUMN IF NOT EXISTS pending_expires_at          timestamptz,
  ADD COLUMN IF NOT EXISTS pending_reminder_2d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_reminder_1d_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.propose_schedule_change(
  p_pattern_type     text,
  p_pattern_data     jsonb,
  p_start_date       date,
  p_starting_parent  text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family_id    uuid;
  v_has_parent_b boolean;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM family_members WHERE family_id = v_family_id AND role = 'parent_b'
  ) INTO v_has_parent_b;

  IF v_has_parent_b THEN
    UPDATE baseline_schedules
    SET
      pending_pattern_type         = p_pattern_type,
      pending_pattern_data         = p_pattern_data,
      pending_start_date           = p_start_date,
      pending_starting_parent      = p_starting_parent,
      pending_proposed_by          = auth.uid(),
      pending_proposed_at          = now(),
      pending_expires_at           = now() + interval '7 days',
      pending_reminder_2d_sent_at  = NULL,
      pending_reminder_1d_sent_at  = NULL
    WHERE family_id = v_family_id;
  ELSE
    -- No Parent B yet -- nothing to confirm, apply straight to the live schedule.
    UPDATE baseline_schedules
    SET
      pattern_type    = p_pattern_type,
      pattern_data    = p_pattern_data,
      start_date      = p_start_date,
      starting_parent = p_starting_parent,
      updated_at      = now(),
      pending_pattern_type         = NULL,
      pending_pattern_data         = NULL,
      pending_start_date           = NULL,
      pending_starting_parent      = NULL,
      pending_proposed_by          = NULL,
      pending_proposed_at          = NULL,
      pending_expires_at           = NULL,
      pending_reminder_2d_sent_at  = NULL,
      pending_reminder_1d_sent_at  = NULL
    WHERE family_id = v_family_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_schedule_proposal(
  p_accept boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF p_accept THEN
    UPDATE baseline_schedules
    SET
      pattern_type    = pending_pattern_type,
      pattern_data    = pending_pattern_data,
      start_date      = pending_start_date,
      starting_parent = pending_starting_parent,
      updated_at      = now(),
      pending_pattern_type         = NULL,
      pending_pattern_data         = NULL,
      pending_start_date           = NULL,
      pending_starting_parent      = NULL,
      pending_proposed_by          = NULL,
      pending_proposed_at          = NULL,
      pending_expires_at           = NULL,
      pending_reminder_2d_sent_at  = NULL,
      pending_reminder_1d_sent_at  = NULL
    WHERE family_id = v_family_id;
  ELSE
    UPDATE baseline_schedules
    SET
      pending_pattern_type         = NULL,
      pending_pattern_data         = NULL,
      pending_start_date           = NULL,
      pending_starting_parent      = NULL,
      pending_proposed_by          = NULL,
      pending_proposed_at          = NULL,
      pending_expires_at           = NULL,
      pending_reminder_2d_sent_at  = NULL,
      pending_reminder_1d_sent_at  = NULL
    WHERE family_id = v_family_id;
  END IF;
END;
$$;
