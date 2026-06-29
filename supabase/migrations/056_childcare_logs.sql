-- Migration 056: Childcare hours logging

CREATE TABLE public.childcare_logs (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid         NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  logged_by      uuid         NOT NULL,
  log_date       date         NOT NULL,
  hours_decimal  numeric(5,2) NOT NULL CHECK (hours_decimal > 0 AND hours_decimal <= 24),
  paying_parent  text         NOT NULL CHECK (paying_parent IN ('parent_a', 'parent_b')),
  notes          text,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (family_id, logged_by, log_date)
);

ALTER TABLE public.childcare_logs ENABLE ROW LEVEL SECURITY;

-- All family members can view logs
CREATE POLICY "childcare_logs_select" ON public.childcare_logs
  FOR SELECT USING (family_id = public.my_family_id());

-- Upsert and delete are handled via SECURITY DEFINER RPCs only.
-- No direct INSERT/UPDATE/DELETE policies — the RPCs enforce the childcare flag.


-- RPC: upsert a log entry (checks the childcare flag in families.config)
CREATE OR REPLACE FUNCTION public.upsert_childcare_log(
  p_date          date,
  p_hours         numeric,
  p_paying_parent text,
  p_notes         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_log_id    uuid;
BEGIN
  SELECT family_id INTO v_family_id
    FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Not in a family';
  END IF;

  -- Verify the caller is designated as a childcare member
  IF NOT EXISTS (
    SELECT 1 FROM families
    WHERE id = v_family_id
      AND (config -> 'childcare_members') @> to_jsonb(auth.uid()::text)
  ) THEN
    RAISE EXCEPTION 'Not a childcare member';
  END IF;

  INSERT INTO childcare_logs
    (family_id, logged_by, log_date, hours_decimal, paying_parent, notes, updated_at)
  VALUES
    (v_family_id, auth.uid(), p_date, p_hours, p_paying_parent, p_notes, now())
  ON CONFLICT (family_id, logged_by, log_date) DO UPDATE SET
    hours_decimal = EXCLUDED.hours_decimal,
    paying_parent = EXCLUDED.paying_parent,
    notes         = EXCLUDED.notes,
    updated_at    = now()
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_childcare_log TO authenticated;


-- RPC: delete own log entry (carer only — parents are view-only)
CREATE OR REPLACE FUNCTION public.delete_childcare_log(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM childcare_logs
  WHERE id        = p_log_id
    AND logged_by = auth.uid()
    AND family_id = public.my_family_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_childcare_log TO authenticated;
