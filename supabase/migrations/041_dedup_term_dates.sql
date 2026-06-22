-- 041: Remove duplicate term date events (schools imported more than once)
-- Keeps one row per unique (family_id, source_subject, title, event_date, end_date)

DELETE FROM family_events
WHERE source = 'term_dates'
  AND id NOT IN (
    SELECT DISTINCT ON (family_id, source_subject, title, event_date, end_date) id
    FROM family_events
    WHERE source = 'term_dates'
    ORDER BY family_id, source_subject, title, event_date, end_date, created_at
  );
