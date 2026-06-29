-- Migration 057: parenting plan tables for parentingplan.help
-- All writes go through SECURITY DEFINER functions (never direct client inserts).
-- RLS is SELECT-only for collaborators; inserts/updates via RPCs only.

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE public.pp_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locale      text        NOT NULL DEFAULT 'en-gb',
  p1_name     text        NOT NULL DEFAULT '',
  p2_name     text        NOT NULL DEFAULT '',
  plan_data   jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pp_collaborators (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid        NOT NULL REFERENCES public.pp_plans(id) ON DELETE CASCADE,
  user_id            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email      text        NOT NULL,
  role               text        NOT NULL DEFAULT 'collaborator'
                                 CHECK (role IN ('owner', 'collaborator')),
  analyses_remaining int         NOT NULL DEFAULT 0,
  has_paid           boolean     NOT NULL DEFAULT false,
  joined_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, invited_email)
);

CREATE TABLE public.pp_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid        NOT NULL REFERENCES public.pp_plans(id) ON DELETE CASCADE,
  created_by     uuid        NOT NULL REFERENCES auth.users(id),
  version_number int         NOT NULL,
  plan_data      jsonb       NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number)
);

CREATE TABLE public.pp_amendments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid        NOT NULL REFERENCES public.pp_plans(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES auth.users(id),
  section         text        NOT NULL,
  field           text        NOT NULL,
  suggested_value text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by     uuid        REFERENCES auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pp_analyses (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid        NOT NULL REFERENCES public.pp_plans(id) ON DELETE CASCADE,
  requested_by   uuid        NOT NULL REFERENCES auth.users(id),
  version_number int         NOT NULL DEFAULT 1,
  result         jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.pp_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_amendments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_analyses     ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a collaborator on this plan?
CREATE OR REPLACE FUNCTION public.pp_is_collaborator(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pp_collaborators
    WHERE plan_id = p_plan_id
      AND user_id = auth.uid()
  );
$$;

-- pp_plans
CREATE POLICY "pp_plans_select" ON public.pp_plans
  FOR SELECT USING (public.pp_is_collaborator(id));

-- pp_collaborators
CREATE POLICY "pp_collaborators_select" ON public.pp_collaborators
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.pp_is_collaborator(plan_id)
  );

-- pp_versions
CREATE POLICY "pp_versions_select" ON public.pp_versions
  FOR SELECT USING (public.pp_is_collaborator(plan_id));

-- pp_amendments
CREATE POLICY "pp_amendments_select" ON public.pp_amendments
  FOR SELECT USING (public.pp_is_collaborator(plan_id));

-- pp_analyses
CREATE POLICY "pp_analyses_select" ON public.pp_analyses
  FOR SELECT USING (public.pp_is_collaborator(plan_id));

-- ── SECURITY DEFINER functions (all writes go through these) ──────────────────

-- Save a plan on first login. Creates plan + owner collaborator + version 1.
CREATE OR REPLACE FUNCTION public.pp_save_plan(
  p_locale    text,
  p_p1_name   text,
  p_p2_name   text,
  p_plan_data jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan_id uuid;
  v_email   text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.pp_plans (created_by, locale, p1_name, p2_name, plan_data)
  VALUES (auth.uid(), p_locale, p_p1_name, p_p2_name, p_plan_data)
  RETURNING id INTO v_plan_id;

  INSERT INTO public.pp_collaborators (plan_id, user_id, invited_email, role, joined_at)
  VALUES (v_plan_id, auth.uid(), v_email, 'owner', now());

  INSERT INTO public.pp_versions (plan_id, created_by, version_number, plan_data, note)
  VALUES (v_plan_id, auth.uid(), 1, p_plan_data, 'Initial plan');

  RETURN v_plan_id;
END;
$$;

-- Invite the other parent. Creates a placeholder collaborator row awaiting them.
CREATE OR REPLACE FUNCTION public.pp_send_invite(
  p_plan_id      uuid,
  p_invite_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.pp_is_collaborator(p_plan_id) THEN
    RAISE EXCEPTION 'not a collaborator';
  END IF;

  INSERT INTO public.pp_collaborators (plan_id, invited_email, role)
  VALUES (p_plan_id, lower(trim(p_invite_email)), 'collaborator')
  ON CONFLICT (plan_id, invited_email) DO NOTHING;

  RETURN true;
END;
$$;

-- Accept an invite. Links the current user to their placeholder collaborator row.
CREATE OR REPLACE FUNCTION public.pp_accept_invite(p_plan_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  UPDATE public.pp_collaborators
  SET user_id   = auth.uid(),
      joined_at = now()
  WHERE plan_id       = p_plan_id
    AND invited_email = lower(trim(v_email))
    AND user_id       IS NULL;

  RETURN FOUND;
END;
$$;

-- Suggest an amendment to a section of the plan.
CREATE OR REPLACE FUNCTION public.pp_add_amendment(
  p_plan_id        uuid,
  p_section        text,
  p_field          text,
  p_suggested_value text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.pp_is_collaborator(p_plan_id) THEN
    RAISE EXCEPTION 'not a collaborator';
  END IF;

  INSERT INTO public.pp_amendments (plan_id, created_by, section, field, suggested_value)
  VALUES (p_plan_id, auth.uid(), p_section, p_field, p_suggested_value)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Accept or reject a pending amendment.
CREATE OR REPLACE FUNCTION public.pp_resolve_amendment(
  p_amendment_id uuid,
  p_status       text  -- 'accepted' or 'rejected'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  SELECT plan_id INTO v_plan_id FROM public.pp_amendments WHERE id = p_amendment_id;

  IF NOT public.pp_is_collaborator(v_plan_id) THEN
    RAISE EXCEPTION 'not a collaborator';
  END IF;

  UPDATE public.pp_amendments
  SET status      = p_status,
      resolved_by = auth.uid(),
      resolved_at = now()
  WHERE id     = p_amendment_id
    AND status = 'pending'
    AND created_by <> auth.uid(); -- can't resolve your own amendment

  RETURN FOUND;
END;
$$;

-- Save a new plan version (snapshot after a round of amendments).
CREATE OR REPLACE FUNCTION public.pp_save_version(
  p_plan_id   uuid,
  p_plan_data jsonb,
  p_note      text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  IF NOT public.pp_is_collaborator(p_plan_id) THEN
    RAISE EXCEPTION 'not a collaborator';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next
  FROM public.pp_versions
  WHERE plan_id = p_plan_id;

  INSERT INTO public.pp_versions (plan_id, created_by, version_number, plan_data, note)
  VALUES (p_plan_id, auth.uid(), v_next, p_plan_data, p_note);

  UPDATE public.pp_plans
  SET plan_data  = p_plan_data,
      updated_at = now()
  WHERE id = p_plan_id;

  RETURN v_next;
END;
$$;

-- Decrement analyses_remaining and store the result (called after Stripe payment confirmed).
CREATE OR REPLACE FUNCTION public.pp_record_analysis(
  p_plan_id      uuid,
  p_result       jsonb,
  p_version_number int DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Decrement counter (will error if 0 due to CHECK in application layer)
  UPDATE public.pp_collaborators
  SET analyses_remaining = analyses_remaining - 1
  WHERE plan_id = p_plan_id
    AND user_id = auth.uid()
    AND analyses_remaining > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no analyses remaining';
  END IF;

  INSERT INTO public.pp_analyses (plan_id, requested_by, version_number, result)
  VALUES (p_plan_id, auth.uid(), p_version_number, p_result)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Grant analyses after payment (called from Stripe webhook edge function).
CREATE OR REPLACE FUNCTION public.pp_grant_analyses(
  p_plan_id uuid,
  p_user_id uuid,
  p_count   int DEFAULT 3
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.pp_collaborators
  SET analyses_remaining = analyses_remaining + p_count,
      has_paid           = true
  WHERE plan_id = p_plan_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$$;
