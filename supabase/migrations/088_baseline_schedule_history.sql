-- 088: Preserve schedule history when a change is applied
--
-- baseline_schedules is a single mutable row per family -- every write path
-- that changes the schedule (accept, the "no Parent B yet" bypass, and the
-- cron auto-apply) overwrote pattern_type/pattern_data/start_date in place,
-- destroying any way to know what pattern applied to dates before the
-- change. getBaselineOwner() (scheduleEngine.js) always computed every date
-- -- past or future -- against whatever the single row's current start_date
-- happened to be. Fixes the "my schedule changed historically too" bug.
--
-- Each write path now archives the about-to-be-superseded row into this
-- table (end_date = new start_date - 1) before overwriting the live row.
-- The client picks the right period per date (getOwnerForDate).

CREATE TABLE public.baseline_schedule_history (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,
  pattern_type     text not null,
  pattern_data     jsonb not null,
  start_date       date not null,
  end_date         date not null check (end_date >= start_date),
  starting_parent  text not null,
  changed_reason   text not null check (changed_reason in ('accepted', 'auto_applied', 'direct')),
  superseded_at    timestamptz not null default now()
);

ALTER TABLE public.baseline_schedule_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_history_select" ON public.baseline_schedule_history
  FOR SELECT USING (family_id = public.my_family_id());

CREATE INDEX baseline_schedule_history_family_dates_idx
  ON public.baseline_schedule_history (family_id, start_date, end_date);

-- ── propose_schedule_change: archive before the "no Parent B" direct-apply ──

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
    -- Archive the about-to-be-superseded period first (skip if this isn't a
    -- genuinely forward-dated change -- nothing meaningful to archive then).
    INSERT INTO baseline_schedule_history
      (family_id, pattern_type, pattern_data, start_date, end_date, starting_parent, changed_reason)
    SELECT family_id, pattern_type, pattern_data, start_date, (p_start_date - 1), starting_parent, 'direct'
    FROM baseline_schedules
    WHERE family_id = v_family_id AND start_date IS NOT NULL AND start_date < p_start_date;

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

-- ── respond_to_schedule_proposal: archive before the accept-branch overwrite ──

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
    INSERT INTO baseline_schedule_history
      (family_id, pattern_type, pattern_data, start_date, end_date, starting_parent, changed_reason)
    SELECT family_id, pattern_type, pattern_data, start_date, (pending_start_date - 1), starting_parent, 'accepted'
    FROM baseline_schedules
    WHERE family_id = v_family_id AND start_date IS NOT NULL AND start_date < pending_start_date;

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
