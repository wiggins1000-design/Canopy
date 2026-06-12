-- Migration 027: Expense tracking
-- expenses table + expense_settlements table + RPCs
-- Run in Supabase SQL editor

CREATE TABLE public.expenses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  paid_by       uuid        NOT NULL,
  amount_pence  integer     NOT NULL CHECK (amount_pence > 0),
  split_pct     integer     NOT NULL DEFAULT 50 CHECK (split_pct >= 0 AND split_pct <= 100),
  category      text        NOT NULL DEFAULT 'other',
  description   text        NOT NULL,
  expense_date  date        NOT NULL DEFAULT CURRENT_DATE,
  child_name    text,
  receipt_url   text,
  settlement_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.expense_settlements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  settled_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_settlement_fkey
  FOREIGN KEY (settlement_id) REFERENCES public.expense_settlements(id);

-- RLS
ALTER TABLE public.expenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT USING (family_id = public.my_family_id());

CREATE POLICY "settlements_select" ON public.expense_settlements
  FOR SELECT USING (family_id = public.my_family_id());

-- ── RPCs ──────────────────────────────────────────────────────────────────────

-- split_pct = percentage of the total that the NON-PAYER owes to the payer
-- e.g. 50 = 50/50; 40 = payer bears 60%, other bears 40%

CREATE OR REPLACE FUNCTION public.create_expense(
  p_amount_pence  integer,
  p_split_pct     integer DEFAULT 50,
  p_category      text    DEFAULT 'other',
  p_description   text    DEFAULT '',
  p_expense_date  date    DEFAULT CURRENT_DATE,
  p_paid_by_self  boolean DEFAULT true,
  p_child_name    text    DEFAULT NULL,
  p_receipt_url   text    DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
  v_paid_by   uuid;
  v_id        uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM public.family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Not in a family'; END IF;

  IF p_paid_by_self THEN
    v_paid_by := auth.uid();
  ELSE
    SELECT user_id INTO v_paid_by
    FROM public.family_members
    WHERE family_id = v_family_id
      AND user_id != auth.uid()
      AND role IN ('parent_a', 'parent_b')
    LIMIT 1;
  END IF;

  IF v_paid_by IS NULL THEN RAISE EXCEPTION 'Could not determine payer'; END IF;

  INSERT INTO public.expenses
    (family_id, paid_by, amount_pence, split_pct, category, description, expense_date, child_name, receipt_url)
  VALUES
    (v_family_id, v_paid_by, p_amount_pence, p_split_pct, p_category, p_description, p_expense_date, p_child_name, p_receipt_url)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Marks all unsettled expenses for the family as settled in one batch
CREATE OR REPLACE FUNCTION public.settle_expenses()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id     uuid;
  v_settlement_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM public.family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Not in a family'; END IF;

  INSERT INTO public.expense_settlements (family_id, settled_by)
  VALUES (v_family_id, auth.uid())
  RETURNING id INTO v_settlement_id;

  UPDATE public.expenses
  SET settlement_id = v_settlement_id
  WHERE family_id = v_family_id AND settlement_id IS NULL;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense  TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expenses TO authenticated;
