-- ── Subscription tracking on families ───────────────────────────────────────
ALTER TABLE public.families
  ADD COLUMN stripe_customer_id      text,
  ADD COLUMN stripe_subscription_id  text,
  ADD COLUMN subscription_status     text NOT NULL DEFAULT 'trialing',
  ADD COLUMN trial_ends_at           timestamptz NOT NULL DEFAULT (now() + interval '10 days'),
  ADD COLUMN subscription_period_end timestamptz;

-- Give all existing families a 30-day grace trial so they are not immediately paywalled
UPDATE public.families
  SET trial_ends_at = now() + interval '30 days'
  WHERE subscription_status = 'trialing';
