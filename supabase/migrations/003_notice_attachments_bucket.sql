-- ============================================================
-- Canopy — create notice-attachments storage bucket
-- Run this in the Supabase SQL editor
-- ============================================================

-- Create the private bucket (public = false means no public URLs by default)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notice-attachments',
  'notice-attachments',
  false,
  20971520,   -- 20 MB per file
  array[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- Allow family members to upload into their own family folder
create policy "notice_attach_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'notice-attachments'
  and (storage.foldername(name))[1] = public.my_family_id()::text
);

-- Allow family members to read their family folder
create policy "notice_attach_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'notice-attachments'
  and (storage.foldername(name))[1] = public.my_family_id()::text
);

-- Allow family members to delete their own uploads
create policy "notice_attach_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'notice-attachments'
  and (storage.foldername(name))[1] = public.my_family_id()::text
);
