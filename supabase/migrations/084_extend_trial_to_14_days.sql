-- 084: Extend free trial from 10 days to 14 days

ALTER TABLE public.families
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- Also extend anyone currently mid-trial by the same +4 days, so no one who
-- signed up under the old 10-day trial ends up worse off than a new signup.
UPDATE public.families
SET trial_ends_at = trial_ends_at + interval '4 days'
WHERE subscription_status = 'trialing';
