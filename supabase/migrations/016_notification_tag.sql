-- ============================================================
-- Canopy — add 'notification' tag type to notice_posts
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.notice_posts
  drop constraint if exists notice_posts_tag_check;

alter table public.notice_posts
  add constraint notice_posts_tag_check
  check (tag in (
    'school','health','appointments','clubs','holidays',
    'finance','logistics','wellbeing','achievements','urgent',
    'notification'
  ));
