-- 075: Add care_type to families, captured during onboarding
-- Stores how the family shares care in families.config.care_type:
-- 'living_together' | 'co_parenting' | 'parallel_parenting' | 'other'.
-- 'co_parenting' and 'parallel_parenting' behave identically today (both
-- get the full two-household setup) -- the distinction is self-identification
-- copy only, not a behavioral fork. Only 'living_together' changes app
-- behavior (skips the mandatory-feeling schedule setup prompt).
-- Existing families have config.care_type = null, which the app treats
-- the same as 'other' (full feature set, nothing hidden).

DROP FUNCTION IF EXISTS create_family(text, text);

CREATE OR REPLACE FUNCTION create_family(
  member_display_name text,
  p_locale             text DEFAULT 'en-GB',
  p_care_type          text DEFAULT 'other'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO families (id, config)
  VALUES (v_family_id, jsonb_build_object(
    'locale',               p_locale,
    'care_type',            p_care_type,
    'fror_expiry_hours',    48,
    'fror_reminder_hours',  24
  ));

  INSERT INTO family_members (family_id, user_id, role, display_name)
  VALUES (v_family_id, auth.uid(), 'parent_a', member_display_name);
END;
$$;
