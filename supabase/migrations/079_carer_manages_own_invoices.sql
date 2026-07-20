-- Migration 079: Carer manages their own invoices, parent is view-only
-- Product decision: the parent should only ever be able to *see* entries, the
-- summary, and the list of invoices with their status -- not act on them. The
-- carer is the one who creates invoices (see migration 080), marks them
-- paid/unpaid (confirming they actually received the money), and deletes an
-- unpaid one if it was created by mistake. Both RPCs below move from
-- parent-or-carer to carer-only (scoped to the specific invoice's carer_id,
-- not just any carer in the family).

CREATE OR REPLACE FUNCTION public.set_childcare_bill_paid(p_bill_id uuid, p_paid boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_bill      public.childcare_bills%ROWTYPE;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Not in a family'; END IF;

  SELECT * INTO v_bill FROM childcare_bills WHERE id = p_bill_id AND family_id = v_family_id;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF v_bill.carer_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the carer this invoice belongs to can update its status';
  END IF;

  UPDATE childcare_bills
  SET status  = CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END,
      paid_at = CASE WHEN p_paid THEN now() ELSE NULL END
  WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_childcare_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_bill      public.childcare_bills%ROWTYPE;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Not in a family'; END IF;

  SELECT * INTO v_bill FROM childcare_bills WHERE id = p_bill_id AND family_id = v_family_id;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF v_bill.carer_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the carer this invoice belongs to can delete it';
  END IF;

  UPDATE childcare_logs SET bill_id = NULL
  WHERE bill_id = p_bill_id AND family_id = v_family_id;

  DELETE FROM childcare_bills
  WHERE id = p_bill_id AND family_id = v_family_id AND status = 'unpaid';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_childcare_bill_paid TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_childcare_bill   TO authenticated;
