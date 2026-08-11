-- 087: Per-instance deletion for recurring events
--
-- family_events stores a recurring series as a single row (event_date +
-- recurrence + recurrence_end); occurrences are expanded client-side
-- (useFamilyEvents.js's expandRecurring), never exploded into separate rows.
-- There was previously no way to remove just one occurrence -- deleting
-- always removed the entire row/series. excluded_dates lets a specific
-- occurrence date be skipped during expansion without touching the series.

ALTER TABLE public.family_events
  ADD COLUMN IF NOT EXISTS excluded_dates date[] NOT NULL DEFAULT '{}';
