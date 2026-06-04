-- ============================================================
-- Canopy — allow notice_posts.author_id to be null
-- Needed for posts created by external email senders (e.g. school newsletters)
-- Run this in the Supabase SQL editor
-- ============================================================

alter table public.notice_posts alter column author_id drop not null;
