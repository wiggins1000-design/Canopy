-- Migration 030: Email 2FA support
-- Adds app_settings singleton, two_factor_codes table, and two_fa_enabled column on family_members.
-- Global flag (app_settings.two_fa_enabled) defaults to FALSE — flip to TRUE in Supabase dashboard to activate.

-- ── App-wide settings (singleton row enforced by PK) ────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  id        boolean PRIMARY KEY DEFAULT true,
  CONSTRAINT app_settings_single_row CHECK (id = true),
  two_fa_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO public.app_settings (id, two_fa_enabled)
VALUES (true, false)
ON CONFLICT DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read app_settings"
  ON public.app_settings FOR SELECT
  USING (auth.role() = 'authenticated');
-- Only service role (Supabase dashboard / admin functions) can update.

-- ── One-time verification codes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.two_factor_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used       boolean     NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS two_factor_codes_user_id_idx ON public.two_factor_codes (user_id);

ALTER TABLE public.two_factor_codes ENABLE ROW LEVEL SECURITY;
-- No client-side policies — only edge functions access this via service role key.

-- ── Per-user 2FA opt-in ──────────────────────────────────────────────────────
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS two_fa_enabled boolean NOT NULL DEFAULT false;
