-- 069: Drop leftovers confirmed unused in application code before dropping.

-- update_term_date_school was superseded by retag_term_dates (migration 036).
DROP FUNCTION IF EXISTS public.update_term_date_school(uuid, uuid[], text);

-- Stripe was fully replaced by RevenueCat (migration 068); no code references
-- these columns any more (create-checkout-session / stripe-webhook edge
-- functions removed alongside this migration).
ALTER TABLE public.families
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;
