-- ============================================================
-- Migrazione da Magic Link a username + password
-- Esegui UNA VOLTA nel SQL Editor del progetto Supabase esistente.
-- Non cancella tornei, risultati o membri già presenti.
-- ============================================================

create schema if not exists private;

-- Rimuove il vecchio flusso di inviti e magic link. I tornei e i membri
-- già presenti restano invariati.
drop function if exists public.invite_tournament_member(uuid, text);
drop function if exists public.accept_my_tournament_invites();
drop table if exists public.tournament_invites cascade;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.normalize_admin_username(p_username text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_temp
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
begin
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  return v_username;
end;
$$;

revoke all on function private.normalize_admin_username(text) from public;
grant execute on function private.normalize_admin_username(text) to authenticated;

drop function if exists public.add_tournament_admin(uuid, text);
drop function if exists public.list_tournament_admins(uuid);
drop function if exists public.remove_tournament_admin(uuid, text);

create function public.add_tournament_admin(
  p_tournament_id uuid,
  p_username text
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_username text := private.normalize_admin_username(p_username);
  v_user_id uuid;
  v_owner_id uuid;
begin
  if not private.is_tournament_owner(p_tournament_id) then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_username || '@admin.beachvolley.app'
  order by u.created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'admin_not_found' using errcode = '22023';
  end if;

  select t.owner_id into v_owner_id
  from public.tournaments t
  where t.id = p_tournament_id;

  if v_user_id = v_owner_id then
    return v_username;
  end if;

  insert into public.tournament_members(tournament_id, user_id, role)
  values (p_tournament_id, v_user_id, 'editor')
  on conflict (tournament_id, user_id) do update set role = 'editor';

  return v_username;
end;
$$;

create function public.list_tournament_admins(p_tournament_id uuid)
returns table(username text, role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not private.is_tournament_editor(p_tournament_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
  select
    lower(split_part(coalesce(u.email, ''), '@', 1))::text,
    tm.role::text,
    tm.created_at
  from public.tournament_members tm
  join auth.users u on u.id = tm.user_id
  where tm.tournament_id = p_tournament_id
  order by case when tm.role = 'owner' then 0 else 1 end, 1;
end;
$$;

create function public.remove_tournament_admin(
  p_tournament_id uuid,
  p_username text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_username text := private.normalize_admin_username(p_username);
  v_user_id uuid;
  v_role text;
begin
  if not private.is_tournament_owner(p_tournament_id) then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  select tm.user_id, tm.role into v_user_id, v_role
  from public.tournament_members tm
  join auth.users u on u.id = tm.user_id
  where tm.tournament_id = p_tournament_id
    and lower(coalesce(u.email, '')) = v_username || '@admin.beachvolley.app'
  limit 1;

  if v_user_id is null then
    return false;
  end if;
  if v_role = 'owner' then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  delete from public.tournament_members
  where tournament_id = p_tournament_id and user_id = v_user_id;

  return found;
end;
$$;

revoke all on function public.add_tournament_admin(uuid, text) from public;
revoke all on function public.list_tournament_admins(uuid) from public;
revoke all on function public.remove_tournament_admin(uuid, text) from public;

grant execute on function public.add_tournament_admin(uuid, text) to authenticated;
grant execute on function public.list_tournament_admins(uuid) to authenticated;
grant execute on function public.remove_tournament_admin(uuid, text) to authenticated;
