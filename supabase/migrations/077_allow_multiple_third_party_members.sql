-- Migration 077: Allow unlimited third_party (external/childcare) members per family
--
-- family_members_family_id_role_key (unique(family_id, role), added in
-- 001_initial_schema.sql) was meant to cap each family at one parent_a and
-- one parent_b, per the comment above it — but the "trigger below" it refers
-- to relaxing this for third_party was never actually written. The plain
-- unique constraint applies to every role, so a family could only ever have
-- ONE third_party member total, silently blocking a second childcare/external
-- invite from ever completing.
--
-- Found 2026-07-19 testing the childcare/external-member invite flow: joining
-- as a second third_party member hit this constraint, which join_family()
-- surfaced as a generic "Invalid or expired invite code" error (see
-- FamilyContext.jsx joinFamily), masking the real cause.
--
-- Replaced with a partial unique index that only restricts parent_a/parent_b.

ALTER TABLE public.family_members
  DROP CONSTRAINT family_members_family_id_role_key;

CREATE UNIQUE INDEX family_members_one_parent_per_role
  ON public.family_members (family_id, role)
  WHERE role IN ('parent_a', 'parent_b');
