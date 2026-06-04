-- ============================================================
-- Canopy — document vault
-- Run this in the Supabase SQL editor
-- ============================================================

-- Storage bucket (private, 20 MB per file)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vault', 'vault', false, 20971520,
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

-- All family members can read vault files
create policy "vault_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.my_family_id()::text
  );

-- Parents only can upload
create policy "vault_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.my_family_id()::text
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

-- Parents only can delete
create policy "vault_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.my_family_id()::text
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

-- Document metadata table
create table public.vault_documents (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  child_name  text not null,  -- child name or 'Family' for shared docs
  title       text not null,
  category    text not null default 'other'
              check (category in ('legal','medical','school','identity','financial','other')),
  file_path   text not null,
  file_name   text not null,
  file_size   integer,
  mime_type   text,
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

alter table public.vault_documents enable row level security;

create policy "vault_docs_select" on public.vault_documents
  for select using (family_id = public.my_family_id());

create policy "vault_docs_insert" on public.vault_documents
  for insert with check (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );

create policy "vault_docs_delete" on public.vault_documents
  for delete using (
    family_id = public.my_family_id()
    and public.my_family_role() in ('parent_a', 'parent_b')
  );
