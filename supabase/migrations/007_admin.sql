-- Admin accounts (completely separate from family members)
create table public.admin_accounts (
  user_id   uuid primary key references auth.users on delete cascade,
  email     text not null,
  created_at timestamptz default now()
);

-- Check if the current authenticated user is an admin
create or replace function public.is_admin()
returns boolean language sql security definer as $$
  select exists(
    select 1 from public.admin_accounts where user_id = auth.uid()
  )
$$;

-- Platform-wide stats
create or replace function public.get_admin_stats()
returns json language plpgsql security definer as $$
begin
  if not public.is_admin() then raise exception 'Unauthorized'; end if;
  return (
    select json_build_object(
      'total_families',  (select count(*) from public.families),
      'total_members',   (select count(*) from public.family_members),
      'new_this_week',   (select count(*) from public.families where created_at > now() - interval '7 days'),
      'new_this_month',  (select count(*) from public.families where created_at > now() - interval '30 days')
    )
  );
end;
$$;

-- Families list with aggregate counts
create or replace function public.get_admin_families(
  p_search text  default null,
  p_limit  int   default 50,
  p_offset int   default 0
)
returns table (
  id           uuid,
  name         text,
  created_at   timestamptz,
  email_key    text,
  member_count bigint,
  has_schedule boolean,
  post_count   bigint,
  event_count  bigint
) language plpgsql security definer as $$
begin
  if not public.is_admin() then raise exception 'Unauthorized'; end if;
  return query
    select
      f.id,
      f.name,
      f.created_at,
      f.email_key,
      count(distinct fm.id)::bigint,
      exists(select 1 from public.baseline_schedules bs where bs.family_id = f.id),
      count(distinct np.id)::bigint,
      count(distinct fe.id)::bigint
    from public.families f
    left join public.family_members fm on fm.family_id = f.id
    left join public.notice_posts   np on np.family_id = f.id
    left join public.family_events  fe on fe.family_id = f.id
    where p_search is null or f.name ilike '%' || p_search || '%'
    group by f.id
    order by f.created_at desc
    limit p_limit offset p_offset;
end;
$$;
