-- Per-member feature preferences stored in family_members.consents.features
-- Allows each parent to independently control which features they see,
-- with awareness shown when the other parent's settings differ.

CREATE OR REPLACE FUNCTION update_member_features(p_features jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE family_members
  SET consents = jsonb_set(
    COALESCE(consents, '{}'),
    '{features}',
    p_features
  )
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION update_member_features(jsonb) TO authenticated;
