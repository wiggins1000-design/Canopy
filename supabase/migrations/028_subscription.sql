-- ── Subscription tracking on families ───────────────────────────────────────
ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  ADD COLUMN IF NOT EXISTS subscription_status     text NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at           timestamptz NOT NULL DEFAULT (now() + interval '10 days'),
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz;

-- Ensure existing families have a trial end date set
UPDATE public.families
  SET trial_ends_at = now() + interval '10 days'
  WHERE subscription_status = 'trialing';
