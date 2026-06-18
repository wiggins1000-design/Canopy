-- Migration 034: Extend message visibility to third-party members when permitted
-- Parents can grant read-only members access to message threads via viewer_permissions.messaging

-- Drop existing SELECT-only policies and replace with broader ones
DROP POLICY IF EXISTS "Parents can view their family threads" ON message_threads;
DROP POLICY IF EXISTS "Parents can view their family messages" ON messages;

CREATE POLICY "Family can view threads" ON message_threads
  FOR SELECT USING (
    family_id IN (
      SELECT fm.family_id
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = auth.uid()
        AND (
          fm.role IN ('parent_a', 'parent_b')
          OR (
            fm.role = 'third_party'
            AND (f.config -> 'viewer_permissions' ->> 'messaging')::boolean = true
          )
        )
    )
  );

CREATE POLICY "Family can view messages" ON messages
  FOR SELECT USING (
    family_id IN (
      SELECT fm.family_id
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = auth.uid()
        AND (
          fm.role IN ('parent_a', 'parent_b')
          OR (
            fm.role = 'third_party'
            AND (f.config -> 'viewer_permissions' ->> 'messaging')::boolean = true
          )
        )
    )
  );
