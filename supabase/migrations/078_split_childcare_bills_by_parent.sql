-- Migration 078: Split childcare bills by parent
-- Bills previously combined both parents' shares into one row (pa_hours/pb_hours
-- breakdown fields, single paid/unpaid status for the combined total) -- meaning
-- one parent's portion couldn't be marked paid independently of the other's, and
-- there was no way to tell "your bill" from "their bill" in the Bills tab. Split
-- into one bill per parent instead: each bill now belongs to exactly one payer.

ALTER TABLE public.childcare_bills
  ADD COLUMN IF NOT EXISTS payer_role text CHECK (payer_role IN ('parent_a', 'parent_b'));

-- Backfill existing rows. A bill only ever had one or both of pa_hours/pb_hours > 0.
-- Single-parent bills just get their role set directly. Any genuinely mixed bill
-- (both > 0) is split: the existing row is repurposed to hold only parent_a's
-- portion, a new row is inserted for parent_b's portion, and the affected logs'
-- bill_id are repointed to whichever row now represents their paying_parent.
DO $$
DECLARE
  r RECORD;
  v_new_bill_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.childcare_bills WHERE pa_hours > 0 AND pb_hours > 0
  LOOP
    INSERT INTO public.childcare_bills
      (family_id, carer_id, period_from, period_to, total_hours, rate_pence,
       total_amount_pence, payer_role, status, paid_at, created_by, created_at)
    VALUES
      (r.family_id, r.carer_id, r.period_from, r.period_to, r.pb_hours, r.rate_pence,
       CASE WHEN r.rate_pence IS NOT NULL THEN ROUND(r.pb_hours * r.rate_pence)::integer ELSE NULL END,
       'parent_b', r.status, r.paid_at, r.created_by, r.created_at)
    RETURNING id INTO v_new_bill_id;

    UPDATE public.childcare_logs
    SET bill_id = v_new_bill_id
    WHERE bill_id = r.id AND paying_parent = 'parent_b';

    UPDATE public.childcare_bills
    SET total_hours        = r.pa_hours,
        total_amount_pence = CASE WHEN r.rate_pence IS NOT NULL THEN ROUND(r.pa_hours * r.rate_pence)::integer ELSE NULL END,
        payer_role          = 'parent_a'
    WHERE id = r.id;
  END LOOP;

  UPDATE public.childcare_bills SET payer_role = 'parent_a' WHERE payer_role IS NULL AND pa_hours > 0 AND pb_hours = 0;
  UPDATE public.childcare_bills SET payer_role = 'parent_b' WHERE payer_role IS NULL AND pb_hours > 0 AND pa_hours = 0;
END $$;

ALTER TABLE public.childcare_bills ALTER COLUMN payer_role SET NOT NULL;
ALTER TABLE public.childcare_bills DROP COLUMN pa_hours;
ALTER TABLE public.childcare_bills DROP COLUMN pb_hours;

-- ── RPC: roll up unbilled logs into per-parent bills ──────────────────────────
-- Creates up to two bills (one per parent), skipping whichever parent has no
-- unbilled hours in the period. Returns the created bill ids.
-- Return type changed from uuid to uuid[] -- Postgres requires dropping first.
DROP FUNCTION IF EXISTS public.create_childcare_bill(uuid, date, date);

CREATE OR REPLACE FUNCTION public.create_childcare_bill(
  p_carer_id uuid,
  p_from     date,
  p_to       date
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_rate      integer;
  v_pa_hrs    numeric(6,2);
  v_pb_hrs    numeric(6,2);
  v_bill_ids  uuid[] := '{}';
  v_bill_id   uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b') LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Only parents can create bills'; END IF;

  SELECT COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_a'), 0),
         COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_b'), 0)
    INTO v_pa_hrs, v_pb_hrs
  FROM childcare_logs
  WHERE family_id = v_family_id
    AND logged_by = p_carer_id
    AND bill_id IS NULL
    AND log_date BETWEEN p_from AND p_to;

  IF v_pa_hrs = 0 AND v_pb_hrs = 0 THEN RAISE EXCEPTION 'No unbilled hours in this period'; END IF;

  SELECT (config -> 'childcare_rates' ->> p_carer_id::text)::integer INTO v_rate
  FROM families WHERE id = v_family_id;

  IF v_pa_hrs > 0 THEN
    INSERT INTO childcare_bills
      (family_id, carer_id, period_from, period_to, total_hours, rate_pence, total_amount_pence, payer_role, created_by)
    VALUES
      (v_family_id, p_carer_id, p_from, p_to, v_pa_hrs, v_rate,
       CASE WHEN v_rate IS NOT NULL THEN ROUND(v_pa_hrs * v_rate)::integer ELSE NULL END,
       'parent_a', auth.uid())
    RETURNING id INTO v_bill_id;
    v_bill_ids := array_append(v_bill_ids, v_bill_id);

    UPDATE childcare_logs SET bill_id = v_bill_id
    WHERE family_id = v_family_id AND logged_by = p_carer_id AND bill_id IS NULL
      AND log_date BETWEEN p_from AND p_to AND paying_parent = 'parent_a';
  END IF;

  IF v_pb_hrs > 0 THEN
    INSERT INTO childcare_bills
      (family_id, carer_id, period_from, period_to, total_hours, rate_pence, total_amount_pence, payer_role, created_by)
    VALUES
      (v_family_id, p_carer_id, p_from, p_to, v_pb_hrs, v_rate,
       CASE WHEN v_rate IS NOT NULL THEN ROUND(v_pb_hrs * v_rate)::integer ELSE NULL END,
       'parent_b', auth.uid())
    RETURNING id INTO v_bill_id;
    v_bill_ids := array_append(v_bill_ids, v_bill_id);

    UPDATE childcare_logs SET bill_id = v_bill_id
    WHERE family_id = v_family_id AND logged_by = p_carer_id AND bill_id IS NULL
      AND log_date BETWEEN p_from AND p_to AND paying_parent = 'parent_b';
  END IF;

  RETURN v_bill_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_childcare_bill TO authenticated;
