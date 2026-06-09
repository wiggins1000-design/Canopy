-- Add contact info fields to the shared school cache so a second family
-- entering the same school URL gets contact details without re-fetching.
alter table public.school_calendars
  add column if not exists school_address text,
  add column if not exists school_email   text,
  add column if not exists school_phone   text,
  add column if not exists head_teacher   text,
  add column if not exists school_hours   text;
