-- ============================================================
-- Canopy — security hardening
-- 1. Remove stale overly-permissive notice-attachments policies
-- 2. Add file size limit to notice-attachments bucket
-- 3. Move family join into atomic SECURITY DEFINER RPC
--    and tighten members_insert to block direct API inserts
-- ============================================================

-- ── 1. Drop stale storage policies ───────────────────────────
-- These were Supabase dashboard auto-generated templates that
-- override the correct family-scoped policies via RLS OR logic.

DROP POLICY IF EXISTS "Public read from notice-attachments"                ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to notice-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Family members can access attachments"              ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 9gbe4b_0" ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 9gbe4b_1" ON storage.objects;

-- ── 2. File size limit on notice-attachments (10 MB) ─────────

UPDATE storage.buckets
SET file_size_limit = 10485760
WHERE id = 'notice-attachments';

-- ── 3. Atomic join_family RPC ────────────────────────────────
-- Validates the invite code, inserts the member, and marks the
-- invite used — all in one transaction, bypassing client-side
-- two-step race conditions.

CREATE OR REPLACE FUNCTION public.join_family(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite  public.family_invites%ROWTYPE;
  v_display text;
BEGIN
  SELECT * INTO v_invite
  FROM public.family_invites
  WHERE code        = upper(p_code)
    AND used        = false
    AND expires_at  > now();

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'invalid_or_expired_invite';
  END IF;

  SELECT COALESCE(raw_user_meta_data->>'display_name', email)
  INTO v_display
  FROM auth.users
  WHERE id = auth.uid();

  INSERT INTO public.family_members (family_id, user_id, role, display_name)
  VALUES (v_invite.family_id, auth.uid(), v_invite.role, v_display)
  ON CONFLICT (family_id, user_id) DO NOTHING;

  UPDATE public.family_invites
  SET used = true, used_by = auth.uid()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'family_id',    v_invite.family_id,
    'role',         v_invite.role,
    'display_name', v_display
  );
END;
$$;

-- ── 4. Tighten members_insert ─────────────────────────────────
-- SECURITY DEFINER RPCs (create_family, join_family) bypass RLS
-- entirely, so they are unaffected by this change.
-- Direct client inserts to family_members are now blocked.

DROP POLICY IF EXISTS "members_insert" ON public.family_members;

CREATE POLICY "members_insert" ON public.family_members
  FOR INSERT WITH CHECK (false);
