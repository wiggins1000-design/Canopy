-- Canopy — admin helper RPCs for invite generation and broadcast

-- Generate a fresh invite link for any family (admin only)
create or replace function public.admin_generate_invite(
  p_family_id uuid,
  p_role      text default 'parent_b'
)
returns text language plpgsql security definer as $$
declare
  v_code text;
begin
  if not public.is_admin() then raise exception 'Unauthorized'; end if;
  insert into public.family_invites (family_id, role, expires_at)
  values (p_family_id, p_role, now() + interval '7 days')
  returning code into v_code;
  return v_code;
end;
$$;

-- Count / list recipients for a broadcast segment (client-side preview)
create or replace function public.admin_get_broadcast_recipients(
  p_segment text default 'all'
)
returns table(email text, display_name text, family_id uuid)
language plpgsql security definer as $$
begin
  if not public.is_admin() then raise exception 'Unauthorized'; end if;
  return query
    select fm.email, fm.display_name, fm.family_id
    from public.family_members fm
    join auth.users u on u.id = fm.user_id
    where fm.role in ('parent_a', 'parent_b')
      and fm.email is not null
      and (
        p_segment = 'all'
        or (
          p_segment = 'inactive_30'
          and (u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '30 days')
        )
      );
end;
$$;
