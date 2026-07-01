-- 059: Add locale support to families
-- Stores the family's locale (e.g. 'en-GB', 'en-US', 'en-AU', 'en-IE') in
-- families.config.locale. Achieved by updating create_family to accept a
-- p_locale parameter and bake it into the initial config JSONB.
-- Existing families have config.locale = null, which the app treats as 'en-GB'.

DROP FUNCTION IF EXISTS create_family(text);

CREATE OR REPLACE FUNCTION create_family(
  member_display_name text,
  p_locale            text DEFAULT 'en-GB'
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
    'fror_expiry_hours',    48,
    'fror_reminder_hours',  24
  ));

  INSERT INTO family_members (family_id, user_id, role, display_name)
  VALUES (v_family_id, auth.uid(), 'parent_a', member_display_name);
END;
$$;
