-- 089: Same propose/deadline/auto-apply pattern as schedule changes
-- (085/086/088), applied to the other feature requiring Parent B's
-- authorization: read-only/third-party viewer permissions.
--
-- Previously handled entirely client-side via plain updateFamilyConfig()
-- calls (ConfigPage.jsx's toggleViewerPerm/confirmViewerPerms/
-- cancelViewerProposal) -- no server-side enforcement of the "no Parent B
-- yet" bypass, and a proposal could sit pending forever with no deadline,
-- same two problems the schedule feature had. Moves this to dedicated
-- SECURITY DEFINER RPCs, stored the same way as before (keys inside
-- families.config JSONB, not new columns -- matches the existing
-- convention for this particular setting) but with the new deadline
-- fields added alongside.

CREATE OR REPLACE FUNCTION public.propose_viewer_permissions(
  p_permissions jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family_id    uuid;
  v_has_parent_b boolean;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM family_members WHERE family_id = v_family_id AND role = 'parent_b'
  ) INTO v_has_parent_b;

  IF v_has_parent_b THEN
    UPDATE families
    SET config = config || jsonb_build_object(
      'pending_viewer_permissions',        p_permissions,
      'viewer_permissions_proposed_by',    auth.uid(),
      'viewer_permissions_proposed_at',    now(),
      'viewer_permissions_expires_at',     now() + interval '7 days',
      'viewer_permissions_reminder_2d_sent_at', null,
      'viewer_permissions_reminder_1d_sent_at', null
    )
    WHERE id = v_family_id;
  ELSE
    -- No Parent B yet -- nothing to confirm, apply straight away.
    UPDATE families
    SET config = config || jsonb_build_object(
      'viewer_permissions',                p_permissions,
      'pending_viewer_permissions',        null,
      'viewer_permissions_proposed_by',    null,
      'viewer_permissions_proposed_at',    null,
      'viewer_permissions_expires_at',     null,
      'viewer_permissions_reminder_2d_sent_at', null,
      'viewer_permissions_reminder_1d_sent_at', null
    )
    WHERE id = v_family_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_viewer_permissions(
  p_accept boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF p_accept THEN
    UPDATE families
    SET config = config || jsonb_build_object(
      'viewer_permissions',                config->'pending_viewer_permissions',
      'pending_viewer_permissions',        null,
      'viewer_permissions_proposed_by',    null,
      'viewer_permissions_proposed_at',    null,
      'viewer_permissions_expires_at',     null,
      'viewer_permissions_reminder_2d_sent_at', null,
      'viewer_permissions_reminder_1d_sent_at', null
    )
    WHERE id = v_family_id;
  ELSE
    UPDATE families
    SET config = config || jsonb_build_object(
      'pending_viewer_permissions',        null,
      'viewer_permissions_proposed_by',    null,
      'viewer_permissions_proposed_at',    null,
      'viewer_permissions_expires_at',     null,
      'viewer_permissions_reminder_2d_sent_at', null,
      'viewer_permissions_reminder_1d_sent_at', null
    )
    WHERE id = v_family_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.propose_viewer_permissions(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_viewer_permissions(boolean) TO authenticated;
