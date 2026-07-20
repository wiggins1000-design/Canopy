-- Migration 081: A parent only sees their own share of childcare data
-- Previously RLS only checked family_id -- any family member could SELECT every
-- row for the whole family, and the frontend did its own filtering on top. That's
-- a UI convenience, not a real privacy boundary (network inspection would still
-- show the other parent's hours/cost). Tightens both tables so a parent only
-- ever receives rows where they are the paying parent, and a carer only ever
-- receives rows they themselves logged/created -- matching what the frontend
-- already restricted for carers, and now genuinely enforcing it for parents too.

DROP POLICY IF EXISTS "childcare_logs_select" ON public.childcare_logs;
CREATE POLICY "childcare_logs_select" ON public.childcare_logs
  FOR SELECT USING (
    family_id = public.my_family_id()
    AND (
      logged_by = auth.uid()
      OR paying_parent = (
        SELECT role FROM public.family_members
        WHERE user_id = auth.uid() AND family_id = public.my_family_id()
      )
    )
  );

DROP POLICY IF EXISTS "childcare_bills_select" ON public.childcare_bills;
CREATE POLICY "childcare_bills_select" ON public.childcare_bills
  FOR SELECT USING (
    family_id = public.my_family_id()
    AND (
      carer_id = auth.uid()
      OR payer_role = (
        SELECT role FROM public.family_members
        WHERE user_id = auth.uid() AND family_id = public.my_family_id()
      )
    )
  );
