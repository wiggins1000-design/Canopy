-- Migration 065: Childcare bills — roll up unbilled hours into a bill, mark paid
-- Mirrors the expenses/expense_settlements pattern (migration 027): a settlement-style
-- table plus a nullable link column on the underlying rows, rather than a "paid" flag
-- on each individual log entry, since bills are usually for a batch of sessions.

ALTER TABLE public.childcare_logs
  ADD COLUMN IF NOT EXISTS bill_id uuid;

CREATE TABLE public.childcare_bills (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          uuid         NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  carer_id           uuid         NOT NULL,
  period_from        date         NOT NULL,
  period_to          date         NOT NULL,
  total_hours        numeric(6,2) NOT NULL,
  rate_pence         integer,
  total_amount_pence integer,
  pa_hours           numeric(6,2) NOT NULL DEFAULT 0,
  pb_hours           numeric(6,2) NOT NULL DEFAULT 0,
  status             text         NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_at            timestamptz,
  created_by         uuid         NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'childcare_logs_bill_fkey') THEN
    ALTER TABLE public.childcare_logs
      ADD CONSTRAINT childcare_logs_bill_fkey
      FOREIGN KEY (bill_id) REFERENCES public.childcare_bills(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.childcare_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "childcare_bills_select" ON public.childcare_bills
  FOR SELECT USING (family_id = public.my_family_id());

-- Writes are RPC-only, same as childcare_logs — no direct INSERT/UPDATE/DELETE policies.

-- ── RPC: roll up unbilled logs for one carer/period into a new bill ──────────
-- Parent-only — carers log hours but don't control billing/payment status.
CREATE OR REPLACE FUNCTION public.create_childcare_bill(
  p_carer_id uuid,
  p_from     date,
  p_to       date
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_bill_id   uuid;
  v_rate      integer;
  v_total_hrs numeric(6,2);
  v_pa_hrs    numeric(6,2);
  v_pb_hrs    numeric(6,2);
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b') LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Only parents can create bills'; END IF;

  SELECT COALESCE(SUM(hours_decimal), 0),
         COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_a'), 0),
         COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_b'), 0)
    INTO v_total_hrs, v_pa_hrs, v_pb_hrs
  FROM childcare_logs
  WHERE family_id = v_family_id
    AND logged_by = p_carer_id
    AND bill_id IS NULL
    AND log_date BETWEEN p_from AND p_to;

  IF v_total_hrs = 0 THEN RAISE EXCEPTION 'No unbilled hours in this period'; END IF;

  SELECT (config -> 'childcare_rates' ->> p_carer_id::text)::integer INTO v_rate
  FROM families WHERE id = v_family_id;

  INSERT INTO childcare_bills
    (family_id, carer_id, period_from, period_to, total_hours, rate_pence, total_amount_pence, pa_hours, pb_hours, created_by)
  VALUES
    (v_family_id, p_carer_id, p_from, p_to, v_total_hrs, v_rate,
     CASE WHEN v_rate IS NOT NULL THEN ROUND(v_total_hrs * v_rate)::integer ELSE NULL END,
     v_pa_hrs, v_pb_hrs, auth.uid())
  RETURNING id INTO v_bill_id;

  UPDATE childcare_logs
  SET bill_id = v_bill_id
  WHERE family_id = v_family_id
    AND logged_by = p_carer_id
    AND bill_id IS NULL
    AND log_date BETWEEN p_from AND p_to;

  RETURN v_bill_id;
END;
$$;

-- ── RPC: toggle a bill's paid status ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_childcare_bill_paid(p_bill_id uuid, p_paid boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b') LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Only parents can update bill status'; END IF;

  UPDATE childcare_bills
  SET status  = CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END,
      paid_at = CASE WHEN p_paid THEN now() ELSE NULL END
  WHERE id = p_bill_id AND family_id = v_family_id;
END;
$$;

-- ── RPC: delete an unpaid bill, unlinking its logs so they become billable again ──
CREATE OR REPLACE FUNCTION public.delete_childcare_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b') LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Only parents can delete bills'; END IF;

  UPDATE childcare_logs SET bill_id = NULL
  WHERE bill_id = p_bill_id AND family_id = v_family_id;

  DELETE FROM childcare_bills
  WHERE id = p_bill_id AND family_id = v_family_id AND status = 'unpaid';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_childcare_bill   TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_childcare_bill_paid TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_childcare_bill   TO authenticated;

-- ── Guard existing log RPCs against editing/deleting billed entries ──────────
-- Once hours are rolled into a bill, changing or deleting them silently would
-- leave the bill's snapshot total untraceable to real entries. Force voiding
-- the bill first (delete_childcare_bill unlinks logs) to make a correction.

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

  IF NOT EXISTS (
    SELECT 1 FROM families
    WHERE id = v_family_id
      AND (config -> 'childcare_members') @> to_jsonb(auth.uid()::text)
  ) THEN
    RAISE EXCEPTION 'Not a childcare member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM childcare_logs
    WHERE family_id = v_family_id AND logged_by = auth.uid() AND log_date = p_date AND bill_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This entry is part of a bill — delete the bill first to change it';
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

CREATE OR REPLACE FUNCTION public.delete_childcare_log(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM childcare_logs WHERE id = p_log_id AND bill_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This entry is part of a bill — delete the bill first to change it';
  END IF;

  DELETE FROM childcare_logs
  WHERE id        = p_log_id
    AND logged_by = auth.uid()
    AND family_id = public.my_family_id();
END;
$$;
