-- Migration 068: RevenueCat subscription sync
-- ============================================================
-- RevenueCat's App User ID is set to family.id (family-wide entitlement —
-- "both parents included, one price" was already the product's positioning
-- before RevenueCat was chosen; this is just the correct technical execution
-- of that existing decision, not a new one). Whichever parent purchases,
-- RevenueCat's webhook updates this family's row directly, so both parents'
-- devices see the same status via the existing family.subscription_status
-- field — no per-device RevenueCat entitlement check needed client-side.
--
-- Written directly by the revenuecat-webhook edge function's service-role
-- client (bypasses RLS, same pattern as every other edge function in this
-- codebase) — no wrapper RPC needed.

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS subscription_platform   text,  -- 'ios' | 'android', which store the active sub came through
  ADD COLUMN IF NOT EXISTS subscription_product_id text;  -- RevenueCat product identifier, e.g. monthly/annual — for support/debugging
