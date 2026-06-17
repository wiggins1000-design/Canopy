-- 033: Add tagged_children to family_events
-- Allows events to be associated with one or more children by name.

ALTER TABLE public.family_events
  ADD COLUMN IF NOT EXISTS tagged_children text[];

-- Update create_family_event to accept tagged_children
CREATE OR REPLACE FUNCTION public.create_family_event(
  p_family_id       uuid,
  p_title           text,
  p_event_date      date,
  p_end_date        date    DEFAULT NULL,
  p_event_time      text    DEFAULT NULL,
  p_end_time        text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_source          text    DEFAULT 'manual',
  p_source_subject  text    DEFAULT NULL,
  p_recurrence      text    DEFAULT NULL,
  p_recurrence_end  date    DEFAULT NULL,
  p_tagged_children text[]  DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.family_events
    (family_id, title, event_date, end_date, event_time, end_time, notes,
     source, source_subject, recurrence, recurrence_end, tagged_children)
  VALUES
    (p_family_id, p_title, p_event_date, p_end_date, p_event_time, p_end_time, p_notes,
     p_source, p_source_subject, p_recurrence, p_recurrence_end, p_tagged_children)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
