-- 025: Direct messaging — topic threads between parents only

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_threads (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id       uuid        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  topic           text        NOT NULL,
  topic_preset    text,
  created_by      uuid        NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean     NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS messages (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id   uuid        NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id),
  content     text        NOT NULL CHECK (char_length(content) > 0),
  sent_at     timestamptz NOT NULL DEFAULT now()
  -- no deleted_at, no edited_at: messages are permanent and tamper-proof
);

CREATE TABLE IF NOT EXISTS message_reads (
  thread_id    uuid        NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads   ENABLE ROW LEVEL SECURITY;

-- Only parents can see/create threads
CREATE POLICY "Parents can view their family threads"
  ON message_threads FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ));

CREATE POLICY "Parents can create threads"
  ON message_threads FOR INSERT
  WITH CHECK (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ));

CREATE POLICY "Parents can update threads (archive / last_message_at)"
  ON message_threads FOR UPDATE
  USING (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ));

-- Only parents can see/send messages
CREATE POLICY "Parents can view their family messages"
  ON messages FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  ));

CREATE POLICY "Parents can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
    )
  );

-- Only parents can manage read receipts
CREATE POLICY "Parents can view read receipts"
  ON message_reads FOR SELECT
  USING (thread_id IN (
    SELECT id FROM message_threads WHERE family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
    )
  ));

CREATE POLICY "Parents can upsert their own read receipts"
  ON message_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Parents can update their own read receipts"
  ON message_reads FOR UPDATE
  USING (user_id = auth.uid());

-- ── Realtime ──────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE message_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE message_reads;

-- ── RPCs (SECURITY DEFINER — bypasses RLS safely) ────────────────────────────

-- Create a new thread
CREATE OR REPLACE FUNCTION create_message_thread(
  p_topic        text,
  p_topic_preset text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_thread_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
  FROM family_members
  WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
  LIMIT 1;
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  INSERT INTO message_threads(family_id, topic, topic_preset, created_by)
  VALUES (v_family_id, p_topic, p_topic_preset, auth.uid())
  RETURNING id INTO v_thread_id;

  RETURN v_thread_id;
END;
$$;

-- Send a message
CREATE OR REPLACE FUNCTION send_message(
  p_thread_id uuid,
  p_content   text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
  v_msg_id    uuid;
BEGIN
  -- Verify caller is a parent in this thread's family
  SELECT family_id INTO v_family_id
  FROM message_threads
  WHERE id = p_thread_id;

  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE user_id = auth.uid()
      AND family_id = v_family_id
      AND role IN ('parent_a', 'parent_b')
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  INSERT INTO messages(thread_id, family_id, sender_id, content)
  VALUES (p_thread_id, v_family_id, auth.uid(), p_content)
  RETURNING id INTO v_msg_id;

  -- Keep last_message_at current
  UPDATE message_threads SET last_message_at = now() WHERE id = p_thread_id;

  RETURN v_msg_id;
END;
$$;

-- Mark a thread as read up to now
CREATE OR REPLACE FUNCTION mark_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM message_threads t
    JOIN family_members fm ON fm.family_id = t.family_id
    WHERE t.id = p_thread_id AND fm.user_id = auth.uid()
      AND fm.role IN ('parent_a', 'parent_b')
  ) THEN RETURN; END IF;

  INSERT INTO message_reads(thread_id, user_id, last_read_at)
  VALUES (p_thread_id, auth.uid(), now())
  ON CONFLICT (thread_id, user_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

-- Archive / unarchive a thread
CREATE OR REPLACE FUNCTION archive_message_thread(p_thread_id uuid, p_archived boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE message_threads
  SET is_archived = p_archived
  WHERE id = p_thread_id
    AND family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent_a', 'parent_b')
    );
END;
$$;
