-- 042: Remove term date events that are fully contained within a longer event
-- from the same school (e.g. "Autumn Half Term" Oct 17–31 contained within
-- "Autumn Holiday" Oct 17–Nov 1 from the same school).
-- Keeps the longer/wider event, deletes the contained one.

DELETE FROM family_events
WHERE source = 'term_dates'
  AND id IN (
    SELECT a.id
    FROM family_events a
    JOIN family_events b ON
      b.source        = 'term_dates'
      AND b.family_id        = a.family_id
      AND b.source_subject   = a.source_subject
      AND b.id              != a.id
      AND b.event_date      <= a.event_date
      AND COALESCE(b.end_date, b.event_date) >= COALESCE(a.end_date, a.event_date)
      -- b must be strictly wider in at least one direction (not an exact duplicate)
      AND (
        b.event_date < a.event_date
        OR COALESCE(b.end_date, b.event_date) > COALESCE(a.end_date, a.event_date)
      )
    WHERE a.source = 'term_dates'
  );
