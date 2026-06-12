-- 026: Schedule change proposals — require other parent to approve

ALTER TABLE public.baseline_schedules
  ADD COLUMN IF NOT EXISTS pending_pattern_type     text
    CHECK (pending_pattern_type IN ('alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom')),
  ADD COLUMN IF NOT EXISTS pending_pattern_data     jsonb,
  ADD COLUMN IF NOT EXISTS pending_start_date       date,
  ADD COLUMN IF NOT EXISTS pending_starting_parent  text
    CHECK (pending_starting_parent IN ('parent_a', 'parent_b')),
  ADD COLUMN IF NOT EXISTS pending_proposed_by      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS pending_proposed_at      timestamptz;

-- Store a pending schedule proposal (overwrites any existing pending proposal)
CREATE OR REPLACE FUNCTION public.propose_schedule_change(
  p_pattern_type     text,
  p_pattern_data     jsonb,
  p_start_date       date,
  p_starting_parent  text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  UPDATE baseline_schedules
  SET
    pending_pattern_type    = p_pattern_type,
    pending_pattern_data    = p_pattern_data,
    pending_start_date      = p_start_date,
    pending_starting_parent = p_starting_parent,
    pending_proposed_by     = auth.uid(),
    pending_proposed_at     = now()
  WHERE family_id = v_family_id;
END;
$$;

-- Accept or decline (or cancel) a pending schedule proposal
-- p_accept = true  → apply pending values to live schedule
-- p_accept = false → discard pending values (decline or cancel)
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
      pending_pattern_type    = NULL,
      pending_pattern_data    = NULL,
      pending_start_date      = NULL,
      pending_starting_parent = NULL,
      pending_proposed_by     = NULL,
      pending_proposed_at     = NULL
    WHERE family_id = v_family_id;
  ELSE
    UPDATE baseline_schedules
    SET
      pending_pattern_type    = NULL,
      pending_pattern_data    = NULL,
      pending_start_date      = NULL,
      pending_starting_parent = NULL,
      pending_proposed_by     = NULL,
      pending_proposed_at     = NULL
    WHERE family_id = v_family_id;
  END IF;
END;
$$;
