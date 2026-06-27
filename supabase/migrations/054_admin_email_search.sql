-- Canopy — extend get_admin_families to also search by member email

drop function if exists public.get_admin_families(text, int, int);

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
    where p_search is null
       or f.name ilike '%' || p_search || '%'
       or exists(
            select 1 from public.family_members fm2
            where fm2.family_id = f.id
              and fm2.email ilike '%' || p_search || '%'
          )
    group by f.id
    order by f.created_at desc
    limit p_limit offset p_offset;
end;
$$;
