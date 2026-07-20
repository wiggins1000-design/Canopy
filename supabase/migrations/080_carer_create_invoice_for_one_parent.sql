-- Migration 080: Invoice creation moves from parent-initiated to carer-initiated
-- Previously only parents could call create_childcare_bill, and it always rolled
-- up both parents' unbilled hours together. Product decision: the carer is the
-- one who should trigger invoicing (they know their own hours and when they're
-- ready to bill), not the parent -- so this flips the permission check to
-- carer-only (only for their own carer_id) and adds an optional p_payer_role so
-- they can target just one parent's share instead of always both at once.

DROP FUNCTION IF EXISTS public.create_childcare_bill(uuid, date, date);

CREATE OR REPLACE FUNCTION public.create_childcare_bill(
  p_carer_id   uuid,
  p_from       date,
  p_to         date,
  p_payer_role text DEFAULT NULL
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
  FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Not in a family'; END IF;

  IF auth.uid() != p_carer_id THEN
    RAISE EXCEPTION 'Only the carer themself can create an invoice';
  END IF;

  IF p_payer_role IS NOT NULL AND p_payer_role NOT IN ('parent_a', 'parent_b') THEN
    RAISE EXCEPTION 'Invalid payer role';
  END IF;

  SELECT COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_a'), 0),
         COALESCE(SUM(hours_decimal) FILTER (WHERE paying_parent = 'parent_b'), 0)
    INTO v_pa_hrs, v_pb_hrs
  FROM childcare_logs
  WHERE family_id = v_family_id
    AND logged_by = p_carer_id
    AND bill_id IS NULL
    AND log_date BETWEEN p_from AND p_to;

  IF p_payer_role = 'parent_b' THEN v_pa_hrs := 0; END IF;
  IF p_payer_role = 'parent_a' THEN v_pb_hrs := 0; END IF;

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
