-- Canopy — immediate activity posting with 15-minute merge window
--
-- Creates a notification post immediately, or appends to the most recent
-- one from the same author if it was created within the last 15 minutes.
-- Returns { is_new: bool, post_id: uuid } so the caller knows whether
-- to send a push notification (only on new post creation).

create or replace function public.upsert_activity_notice(
  p_family_id    uuid,
  p_activity     text,
  p_author_name  text  default 'A parent'
)
returns jsonb language plpgsql security definer as $$
declare
  v_post_id  uuid;
  v_is_new   boolean := false;
begin
  select id into v_post_id
  from public.notice_posts
  where family_id   = p_family_id
    and author_id   = auth.uid()
    and tag         = 'notification'
    and is_archived = false
    and created_at  > now() - interval '15 minutes'
  order by created_at desc
  limit 1;

  if v_post_id is not null then
    update public.notice_posts
    set content = content || E'\n• ' || p_activity
    where id = v_post_id;
  else
    insert into public.notice_posts (family_id, author_id, content, tag)
    values (
      p_family_id,
      auth.uid(),
      '📋 ' || p_author_name || ' made the following updates:' || E'\n\n• ' || p_activity,
      'notification'
    )
    returning id into v_post_id;
    v_is_new := true;
  end if;

  return jsonb_build_object('is_new', v_is_new, 'post_id', v_post_id);
end;
$$;
