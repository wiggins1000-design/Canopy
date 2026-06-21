-- Migration 033 added p_tagged_children to create_family_event via CREATE OR REPLACE.
-- Because the signature changed, Postgres kept the old 11-param overload alongside the
-- new 12-param one. PostgREST (PGRST203) cannot resolve which to call when invoked
-- without p_tagged_children. Drop the old overload; the new one has DEFAULT NULL so
-- callers that omit p_tagged_children continue to work.

DROP FUNCTION IF EXISTS public.create_family_event(
  uuid, text, date, date, text, text, text, text, text, text, date
);
