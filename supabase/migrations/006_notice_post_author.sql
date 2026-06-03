-- ============================================================
-- Canopy — allow create_notice_post to accept an explicit author_id
-- Needed for Edge Functions that run without an authenticated user context
-- Run this in the Supabase SQL editor
-- ============================================================

create or replace function public.create_notice_post(
  p_family_id  uuid,
  p_content    text,
  p_image_url  text    default null,
  p_file_url   text    default null,
  p_file_name  text    default null,
  p_tag        text    default null,
  p_author_id  uuid    default null
)
returns void language plpgsql security definer as $$
begin
  insert into public.notice_posts (family_id, author_id, content, image_url, file_url, file_name, tag)
  values (
    p_family_id,
    coalesce(p_author_id, auth.uid()),
    p_content,
    p_image_url,
    p_file_url,
    p_file_name,
    p_tag
  );
end;
$$;
