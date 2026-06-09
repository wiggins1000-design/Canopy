-- 019: Read receipts, holiday requests, iCal sync, calendar OAuth connections, court orders

-- ── Read receipts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notice_post_reads (
  post_id   uuid NOT NULL REFERENCES notice_posts(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families(id)     ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE notice_post_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can see reads for their family"
  ON notice_post_reads FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can mark posts as read"
  ON notice_post_reads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND family_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE notice_post_reads;

CREATE OR REPLACE FUNCTION mark_post_read(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RETURN; END IF;
  INSERT INTO notice_post_reads(post_id, user_id, family_id)
  VALUES (p_post_id, auth.uid(), v_family_id)
  ON CONFLICT (post_id, user_id) DO NOTHING;
END;
$$;

-- ── Holiday requests ───────────────────────────────────────────────────────────

ALTER TABLE schedule_changes
  ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;

-- ── iCal feed token ────────────────────────────────────────────────────────────

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS ical_token text;

CREATE OR REPLACE FUNCTION get_or_create_ical_token()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_token     text;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT ical_token INTO v_token FROM families WHERE id = v_family_id;
  IF v_token IS NULL THEN
    v_token := encode(gen_random_bytes(24), 'hex');
    UPDATE families SET ical_token = v_token WHERE id = v_family_id;
  END IF;
  RETURN v_token;
END;
$$;

-- ── Calendar connections (Google / Outlook OAuth) ─────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_connections (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id     uuid        NOT NULL REFERENCES families(id)   ON DELETE CASCADE,
  provider      text        NOT NULL CHECK (provider IN ('google', 'outlook')),
  access_token  text,
  refresh_token text,
  token_expiry  timestamptz,
  calendar_id   text,
  sync_types    text[]      NOT NULL DEFAULT ARRAY['events', 'schedule_changes'],
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar connections"
  ON calendar_connections FOR ALL
  USING   (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RPC to upsert connection tokens (called from OAuth callback edge function)
CREATE OR REPLACE FUNCTION upsert_calendar_connection(
  p_provider      text,
  p_access_token  text,
  p_refresh_token text,
  p_token_expiry  timestamptz,
  p_calendar_id   text,
  p_sync_types    text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_id        uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  INSERT INTO calendar_connections(
    user_id, family_id, provider,
    access_token, refresh_token, token_expiry,
    calendar_id, sync_types, updated_at
  )
  VALUES (
    auth.uid(), v_family_id, p_provider,
    p_access_token, p_refresh_token, p_token_expiry,
    p_calendar_id, p_sync_types, now()
  )
  ON CONFLICT (user_id, provider)
  DO UPDATE SET
    access_token  = EXCLUDED.access_token,
    refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
    token_expiry  = EXCLUDED.token_expiry,
    calendar_id   = EXCLUDED.calendar_id,
    sync_types    = EXCLUDED.sync_types,
    is_active     = true,
    updated_at    = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Court orders ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court_orders (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id   uuid        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  file_url    text,
  file_name   text,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'analyzing', 'needs_approval', 'active', 'failed')),
  raw_rules   jsonb,
  approved_by uuid[]      NOT NULL DEFAULT '{}',
  error_msg   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE court_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can read court orders"
  ON court_orders FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Parents can manage court orders"
  ON court_orders FOR ALL
  USING (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ))
  WITH CHECK (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ));

CREATE OR REPLACE FUNCTION approve_court_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_approved uuid[];
BEGIN
  SELECT array_append(approved_by, auth.uid()) INTO v_new_approved
  FROM court_orders
  WHERE id = p_order_id
    AND family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
    )
    AND NOT (auth.uid() = ANY(approved_by));

  IF v_new_approved IS NULL THEN RETURN; END IF;

  UPDATE court_orders
  SET
    approved_by = v_new_approved,
    status      = CASE
                    WHEN array_length(v_new_approved, 1) >= 2 THEN 'active'
                    ELSE 'needs_approval'
                  END,
    updated_at  = now()
  WHERE id = p_order_id;
END;
$$;
