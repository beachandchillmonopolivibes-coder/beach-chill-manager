-- ============================================================
-- Beach Volley Tournament Manager Pro - Supabase schema
-- Versione PRO v11: username/password, RLS e blocco iscrizioni all’avvio
--
-- Nuova installazione: esegui tutto il file nel SQL Editor.
-- Progetto esistente v10: esegui MIGRATION_PRO_V11.sql.
-- Legacy Magic Link: prima MIGRATION_ADMIN_LOGIN.sql, poi MIGRATION_PRO_V11.sql.
-- ============================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  public_read boolean not null default true,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournaments_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$')
);

create table if not exists public.tournament_members (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create index if not exists tournament_members_user_idx
  on public.tournament_members(user_id, tournament_id);
create index if not exists tournaments_slug_idx
  on public.tournaments(slug);

-- ------------------------------------------------------------
-- Helper privati
-- ------------------------------------------------------------
create or replace function private.is_tournament_editor(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tournament_members tm
    where tm.tournament_id = p_tournament_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'editor')
  );
$$;

create or replace function private.is_tournament_owner(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tournament_members tm
    where tm.tournament_id = p_tournament_id
      and tm.user_id = (select auth.uid())
      and tm.role = 'owner'
  );
$$;

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

revoke all on function private.is_tournament_editor(uuid) from public;
revoke all on function private.is_tournament_owner(uuid) from public;
revoke all on function private.normalize_admin_username(text) from public;
grant execute on function private.is_tournament_editor(uuid) to anon, authenticated;
grant execute on function private.is_tournament_owner(uuid) to authenticated;
grant execute on function private.normalize_admin_username(text) to authenticated;

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;

drop policy if exists "Public or members can read tournaments" on public.tournaments;
drop policy if exists "Members can read tournament members" on public.tournament_members;

create policy "Public or members can read tournaments"
on public.tournaments
for select
to anon, authenticated
using (
  public_read
  or owner_id = (select auth.uid())
  or private.is_tournament_editor(id)
);

create policy "Members can read tournament members"
on public.tournament_members
for select
to authenticated
using (private.is_tournament_editor(tournament_id));

grant select on public.tournaments to anon, authenticated;
grant select on public.tournament_members to authenticated;
revoke insert, update, delete on public.tournaments from anon, authenticated;
revoke insert, update, delete on public.tournament_members from anon, authenticated;

-- ------------------------------------------------------------
-- Torneo e stato condiviso
-- ------------------------------------------------------------
create or replace function public.create_tournament(
  p_name text,
  p_slug text,
  p_state jsonb
)
returns public.tournaments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.tournaments;
  v_slug text := lower(trim(p_slug));
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  insert into public.tournaments(name, slug, owner_id, public_read, state)
  values (trim(p_name), v_slug, v_user, true, coalesce(p_state, '{}'::jsonb))
  returning * into v_row;

  insert into public.tournament_members(tournament_id, user_id, role)
  values (v_row.id, v_user, 'owner')
  on conflict (tournament_id, user_id) do update set role = 'owner';

  return v_row;
exception
  when unique_violation then
    raise exception 'slug_already_exists' using errcode = '23505';
end;
$$;

create or replace function public.save_tournament_state(
  p_tournament_id uuid,
  p_state jsonb,
  p_expected_revision bigint
)
returns public.tournaments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tournaments;
begin
  if not private.is_tournament_editor(p_tournament_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.tournaments
  set state = coalesce(p_state, '{}'::jsonb),
      revision = revision + 1,
      updated_at = now()
  where id = p_tournament_id
    and revision = p_expected_revision
  returning * into v_row;

  if not found then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  return v_row;
end;
$$;

create or replace function public.get_my_tournament_role(p_tournament_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.role
  from public.tournament_members tm
  where tm.tournament_id = p_tournament_id
    and tm.user_id = (select auth.uid())
  limit 1;
$$;

-- ------------------------------------------------------------
-- Amministratori tramite username
-- Gli account Auth vengono creati nel Dashboard con password e un
-- indirizzo tecnico: username@admin.beachvolley.app.
-- ------------------------------------------------------------
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

create or replace function public.set_tournament_public_read(
  p_tournament_id uuid,
  p_public_read boolean
)
returns public.tournaments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tournaments;
begin
  if not private.is_tournament_owner(p_tournament_id) then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  update public.tournaments
  set public_read = p_public_read,
      updated_at = now()
  where id = p_tournament_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- Permessi RPC
-- ------------------------------------------------------------
revoke all on function public.create_tournament(text, text, jsonb) from public;
revoke all on function public.save_tournament_state(uuid, jsonb, bigint) from public;
revoke all on function public.get_my_tournament_role(uuid) from public;
revoke all on function public.add_tournament_admin(uuid, text) from public;
revoke all on function public.list_tournament_admins(uuid) from public;
revoke all on function public.remove_tournament_admin(uuid, text) from public;
revoke all on function public.set_tournament_public_read(uuid, boolean) from public;

grant execute on function public.create_tournament(text, text, jsonb) to authenticated;
grant execute on function public.save_tournament_state(uuid, jsonb, bigint) to authenticated;
grant execute on function public.get_my_tournament_role(uuid) to authenticated;
grant execute on function public.add_tournament_admin(uuid, text) to authenticated;
grant execute on function public.list_tournament_admins(uuid) to authenticated;
grant execute on function public.remove_tournament_admin(uuid, text) to authenticated;
grant execute on function public.set_tournament_public_read(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
alter table public.tournaments replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;
-- Beach & Chill PRO v11 — migrazione NON distruttiva dopo lo schema username/password.
-- Eseguire tutto nel SQL Editor. Nuove installazioni: basta schema.sql.
-- Nessuna credenziale privata nel frontend. Le scritture avvengono solo via RPC.
begin;

revoke create on schema public from public, anon, authenticated;

-- Proiezione della configurazione statica: i soli campi esclusi sono i contatori
-- dei bye, aggiornati automaticamente dal motore quando avanza/corregge i turni.
create or replace function private.static_tournament_settings(p_settings jsonb)
returns jsonb language sql immutable set search_path = pg_temp as $$
  select (p_settings - array['byePolicy', 'formatOptions']::text[]) || jsonb_build_object(
    'formatOptions', coalesce(p_settings->'formatOptions', '{}'::jsonb) - 'playoffMatchRule',
    'byePolicy', coalesce(p_settings->'byePolicy', '{}'::jsonb)
      - array['cursor', 'lastTeamId', 'history']::text[]
  );
$$;
revoke all on function private.static_tournament_settings(jsonb) from public;

create or replace function private.guard_tournament_state()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state jsonb := new.state;
  v_item jsonb;
  v_set jsonb;
  v_score text;
  v_side text;
  v_old_teams jsonb;
  v_new_teams jsonb;
  v_old_initial jsonb;
  v_new_initial jsonb;
  v_active_ids jsonb;
  v_started text;
  v_locked boolean := false;
begin
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then
    return new;
  end if;
  if v_state is null or jsonb_typeof(v_state) <> 'object'
     or octet_length(v_state::text) > 1048576
     or jsonb_typeof(v_state->'teams') is distinct from 'array'
     or jsonb_typeof(v_state->'matches') is distinct from 'array'
     or jsonb_typeof(v_state->'groups') is distinct from 'array'
     or jsonb_typeof(v_state->'settings') is distinct from 'object'
     or jsonb_typeof(v_state->'metadata') is distinct from 'object' then
    raise exception 'invalid_tournament_state' using errcode = '22023';
  end if;
  if jsonb_array_length(v_state->'teams') not between 2 and 24
     or jsonb_array_length(v_state->'matches') > 1000 then
    raise exception 'invalid_tournament_state' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_state->'teams')) <>
     (select count(distinct value->>'id') from jsonb_array_elements(v_state->'teams')) then
    raise exception 'duplicate_team_id' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value->>'id'), '[]'::jsonb) into v_active_ids
    from jsonb_array_elements(v_state->'teams') where btrim(coalesce(value->>'name','')) <> '';
  for v_item in select value from jsonb_array_elements(v_state->'teams') loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or length(v_item->>'id') not between 1 and 100
       or jsonb_typeof(v_item->'name') is distinct from 'string'
       or length(v_item->>'name') > 120 then
      raise exception 'invalid_team' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_state->'matches')) <>
     (select count(distinct value->>'id') from jsonb_array_elements(v_state->'matches')) then
    raise exception 'duplicate_match_id' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_state->'matches') loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or length(v_item->>'id') not between 1 and 100
       or coalesce(v_item->>'stage','') !~ '^[0-9]{1,4}$'
       or coalesce(v_item->>'bracket','') not in ('I','W','L','F','G','K','S')
       or coalesce(v_item->>'rule','') not in ('single_21','single_15','best_of_3_15','best_of_3_21_15')
       or jsonb_typeof(v_item->'sets') is distinct from 'array' then
      raise exception 'invalid_match' using errcode = '22023';
    end if;
    if jsonb_array_length(v_item->'sets') <> 3 then
      raise exception 'invalid_match_score' using errcode = '22023';
    end if;
    if (nullif(v_item->>'aId','') is not null and not v_active_ids ? (v_item->>'aId'))
       or (nullif(v_item->>'bId','') is not null and not v_active_ids ? (v_item->>'bId'))
       or (nullif(v_item->>'aId','') is not null and v_item->>'aId' = v_item->>'bId')
       or (nullif(v_item->>'winnerId','') is not null and (v_item->>'winnerId') is distinct from (v_item->>'aId') and (v_item->>'winnerId') is distinct from (v_item->>'bId'))
       or (nullif(v_item->>'loserId','') is not null and (v_item->>'loserId') is distinct from (v_item->>'aId') and (v_item->>'loserId') is distinct from (v_item->>'bId')) then
      raise exception 'invalid_match_team' using errcode = '22023';
    end if;
    for v_set in select value from jsonb_array_elements(v_item->'sets') loop
      foreach v_side in array array['a','b'] loop
        v_score := v_set->>v_side;
        if jsonb_typeof(v_set) <> 'object' or v_score is null
           or jsonb_typeof(v_set->v_side) not in ('string','number')
           or (v_score <> '' and v_score !~ '^[0-9]{1,3}$') then
          raise exception 'invalid_match_score' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end loop;

  if tg_op = 'UPDATE' then
    v_locked := nullif(old.state #>> '{metadata,startedAt}', '') is not null
      or (case when jsonb_typeof(old.state->'matches') = 'array'
               then jsonb_array_length(old.state->'matches') > 0 else false end);
    if v_locked then
      v_started := coalesce(nullif(old.state #>> '{metadata,startedAt}', ''),
                            nullif(old.state #>> '{settings,draw,generatedAt}', ''),
                            nullif(old.state #>> '{metadata,createdAt}', ''));
      if jsonb_array_length(v_state->'matches') = 0
         or (v_started is not null and (v_state #>> '{metadata,startedAt}') is distinct from v_started)
         or private.static_tournament_settings(v_state->'settings') is distinct from private.static_tournament_settings(old.state->'settings')
         or v_state->'groups' is distinct from old.state->'groups' then
        raise exception 'tournament_structure_locked' using errcode = '22023';
      end if;
      select jsonb_agg((value - array['name','losses','byes','initialByes','fairByes','technicalByes','out','updatedAt']::text[])
               || jsonb_build_object('registered', btrim(coalesce(value->>'name','')) <> '') order by ord)
        into v_old_teams from jsonb_array_elements(old.state->'teams') with ordinality as t(value,ord);
      select jsonb_agg((value - array['name','losses','byes','initialByes','fairByes','technicalByes','out','updatedAt']::text[])
               || jsonb_build_object('registered', btrim(coalesce(value->>'name','')) <> '') order by ord)
        into v_new_teams from jsonb_array_elements(v_state->'teams') with ordinality as t(value,ord);
      if v_old_teams is distinct from v_new_teams then
        raise exception 'tournament_roster_locked' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg((value - array['sets','winnerId','loserId','updatedAt','groupRound']::text[])
               || jsonb_build_object('groupRound', nullif(value->>'groupRound', '0')) order by value->>'id'), '[]'::jsonb)
        into v_old_initial from jsonb_array_elements(old.state->'matches') where value->>'stage' = '0';
      select coalesce(jsonb_agg((value - array['sets','winnerId','loserId','updatedAt','groupRound']::text[])
               || jsonb_build_object('groupRound', nullif(value->>'groupRound', '0')) order by value->>'id'), '[]'::jsonb)
        into v_new_initial from jsonb_array_elements(v_state->'matches') where value->>'stage' = '0';
      if v_old_initial is distinct from v_new_initial then
        raise exception 'tournament_draw_locked' using errcode = '22023';
      end if;
    end if;
  end if;
  if jsonb_array_length(v_state->'matches') > 0 then
    v_started := coalesce(v_started, nullif(v_state #>> '{metadata,startedAt}', ''),
                          nullif(v_state #>> '{settings,draw,generatedAt}', ''),
                          nullif(v_state #>> '{metadata,createdAt}', ''), to_jsonb(now()) #>> '{}');
    new.state := jsonb_set(v_state, '{metadata,startedAt}', to_jsonb(v_started), true);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_tournament_state() from public;
drop trigger if exists tournament_state_guard on public.tournaments;
create trigger tournament_state_guard before insert or update of state
  on public.tournaments for each row execute function private.guard_tournament_state();

-- La modifica della visibilità deve invalidare le revisioni di eventuali bozze.
create or replace function public.set_tournament_public_read(p_tournament_id uuid, p_public_read boolean)
returns public.tournaments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.tournaments;
begin
  if not private.is_tournament_owner(p_tournament_id) then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if p_public_read is null then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  update public.tournaments set public_read = p_public_read, revision = revision + 1, updated_at = now()
    where id = p_tournament_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_tournament_public_read(uuid, boolean) from public;
grant execute on function public.set_tournament_public_read(uuid, boolean) to authenticated;

-- Verifica esplicita della revisione: NULL non può aggirare il controllo concorrente.
create or replace function public.save_tournament_state(p_tournament_id uuid, p_state jsonb, p_expected_revision bigint)
returns public.tournaments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.tournaments;
begin
  if not private.is_tournament_editor(p_tournament_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  update public.tournaments set state = p_state, revision = revision + 1, updated_at = now()
    where id = p_tournament_id and revision = p_expected_revision returning * into v_row;
  if not found then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_tournament_state(uuid, jsonb, bigint) from public;
grant execute on function public.save_tournament_state(uuid, jsonb, bigint) to authenticated;

commit;
