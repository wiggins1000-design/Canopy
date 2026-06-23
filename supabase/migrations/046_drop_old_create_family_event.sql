-- 046: Drop the original create_family_event overload (without p_school_calendar_id)
-- Migration 044 added p_school_calendar_id, creating two overloads. PostgreSQL
-- cannot resolve the ambiguity when the parameter is omitted, causing all
-- photo/manual inserts to fail. Drop the old signature; the 044 version
-- (with p_school_calendar_id DEFAULT NULL) handles both cases.

DROP FUNCTION IF EXISTS public.create_family_event(
  uuid, text, date, date, text, text, text, text, text, text, date, text[]
);
