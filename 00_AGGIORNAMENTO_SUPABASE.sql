-- INIZIO FILE COMPLETO: 00_AGGIORNAMENTO_SUPABASE.sql
-- Per il progetto esistente con schema PRO v11 o successivo. Eseguire tutto in un solo Run.
-- Installa bozze private e rimozione del tabellone. Non modifica tornei, risultati o accessi esistenti.
begin;
alter table public.tournaments alter column public_read set default false; create or replace function public.create_tournament_draft( p_name text,
p_slug text, p_state jsonb )
returns public.tournaments language plpgsql security definer
set search_path = public, pg_temp as $shared_draft$ declare
v_user uuid := (select auth.uid()); v_row public.tournaments; v_slug text := lower(trim(coalesce(p_slug, '')));
begin if v_user is null then raise exception 'authentication_required' using errcode = '42501';
end if; if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023';
end if; if v_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' then raise exception 'invalid_slug' using errcode = '22023';
end if; insert into public.tournaments(name, slug, owner_id, public_read, state) values (trim(p_name), v_slug, v_user, false, p_state)
returning * into v_row; insert into public.tournament_members(tournament_id, user_id, role) values (v_row.id, v_user, 'owner');
return v_row; exception when unique_violation then
raise exception 'slug_already_exists' using errcode = '23505'; end; $shared_draft$;
revoke all on function public.create_tournament_draft(text, text, jsonb) from public, anon; grant execute on function public.create_tournament_draft(text, text, jsonb) to authenticated; create table if not exists private.bracket_reset_context (
tournament_id uuid primary key references public.tournaments(id) on delete cascade, transaction_id bigint not null, user_id uuid not null,
expected_revision bigint not null, reset_state jsonb not null );
revoke all on private.bracket_reset_context from public, anon, authenticated; alter table private.bracket_reset_context enable row level security; create or replace function private.guard_tournament_state()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $guard_reset$ declare v_state jsonb := new.state;
v_item jsonb; v_set jsonb; v_score text;
v_side text; v_old_teams jsonb; v_new_teams jsonb;
v_old_initial jsonb; v_new_initial jsonb; v_active_ids jsonb;
v_started text; v_locked boolean := false; begin
if tg_op = 'UPDATE' and new.state is not distinct from old.state then return new; end if;
if v_state is null or jsonb_typeof(v_state) <> 'object' or octet_length(v_state::text) > 1048576 or jsonb_typeof(v_state->'teams') is distinct from 'array'
or jsonb_typeof(v_state->'matches') is distinct from 'array' or jsonb_typeof(v_state->'groups') is distinct from 'array' or jsonb_typeof(v_state->'settings') is distinct from 'object'
or jsonb_typeof(v_state->'metadata') is distinct from 'object' then raise exception 'invalid_tournament_state' using errcode = '22023'; end if;
if jsonb_array_length(v_state->'teams') not between 2 and 24 or jsonb_array_length(v_state->'matches') > 1000 then raise exception 'invalid_tournament_state' using errcode = '22023';
end if; if (select count(*) from jsonb_array_elements(v_state->'teams')) <> (select count(distinct value->>'id') from jsonb_array_elements(v_state->'teams')) then
raise exception 'duplicate_team_id' using errcode = '22023'; end if; select coalesce(jsonb_agg(value->>'id'), '[]'::jsonb) into v_active_ids
from jsonb_array_elements(v_state->'teams') where btrim(coalesce(value->>'name','')) <> ''; for v_item in select value from jsonb_array_elements(v_state->'teams') loop if jsonb_typeof(v_item) <> 'object'
or jsonb_typeof(v_item->'id') is distinct from 'string' or length(v_item->>'id') not between 1 and 100 or jsonb_typeof(v_item->'name') is distinct from 'string'
or length(v_item->>'name') > 120 then raise exception 'invalid_team' using errcode = '22023'; end if;
end loop; if (select count(*) from jsonb_array_elements(v_state->'matches')) <> (select count(distinct value->>'id') from jsonb_array_elements(v_state->'matches')) then
raise exception 'duplicate_match_id' using errcode = '22023'; end if; for v_item in select value from jsonb_array_elements(v_state->'matches') loop
if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'id') is distinct from 'string' or length(v_item->>'id') not between 1 and 100
or coalesce(v_item->>'stage','') !~ '^[0-9]{1,4}$' or coalesce(v_item->>'bracket','') not in ('I','W','L','F','G','K','S') or coalesce(v_item->>'rule','') not in ('single_21','single_15','best_of_3_15','best_of_3_21_15')
or jsonb_typeof(v_item->'sets') is distinct from 'array' then raise exception 'invalid_match' using errcode = '22023'; end if;
if jsonb_array_length(v_item->'sets') <> 3 then raise exception 'invalid_match_score' using errcode = '22023'; end if;
if (nullif(v_item->>'aId','') is not null and not v_active_ids ? (v_item->>'aId')) or (nullif(v_item->>'bId','') is not null and not v_active_ids ? (v_item->>'bId')) or (nullif(v_item->>'aId','') is not null and v_item->>'aId' = v_item->>'bId')
or (nullif(v_item->>'winnerId','') is not null and (v_item->>'winnerId') is distinct from (v_item->>'aId') and (v_item->>'winnerId') is distinct from (v_item->>'bId')) or (nullif(v_item->>'loserId','') is not null and (v_item->>'loserId') is distinct from (v_item->>'aId') and (v_item->>'loserId') is distinct from (v_item->>'bId')) then raise exception 'invalid_match_team' using errcode = '22023';
end if; for v_set in select value from jsonb_array_elements(v_item->'sets') loop foreach v_side in array array['a','b'] loop
v_score := v_set->>v_side; if jsonb_typeof(v_set) <> 'object' or v_score is null or jsonb_typeof(v_set->v_side) not in ('string','number')
or (v_score <> '' and v_score !~ '^[0-9]{1,3}$') then raise exception 'invalid_match_score' using errcode = '22023'; end if;
end loop; end loop; end loop;
if tg_op = 'UPDATE' then v_locked := nullif(old.state #>> '{metadata,startedAt}', '') is not null or (case when jsonb_typeof(old.state->'matches') = 'array'
then jsonb_array_length(old.state->'matches') > 0 else false end); if v_locked and exists ( select 1 from private.bracket_reset_context c
where c.tournament_id = old.id and c.transaction_id = txid_current() and c.user_id = (select auth.uid())
and c.expected_revision = old.revision and c.reset_state = new.state and new.revision = old.revision + 1
and new.public_read = false and private.is_tournament_owner(old.id) ) then
return new; end if; if v_locked then
v_started := coalesce(nullif(old.state #>> '{metadata,startedAt}', ''), nullif(old.state #>> '{settings,draw,generatedAt}', ''), nullif(old.state #>> '{metadata,createdAt}', ''));
if jsonb_array_length(v_state->'matches') = 0 or (v_started is not null and (v_state #>> '{metadata,startedAt}') is distinct from v_started) or private.static_tournament_settings(v_state->'settings') is distinct from private.static_tournament_settings(old.state->'settings')
or v_state->'groups' is distinct from old.state->'groups' then raise exception 'tournament_structure_locked' using errcode = '22023'; end if;
select jsonb_agg((value - array['name','losses','byes','initialByes','fairByes','technicalByes','out','updatedAt']::text[]) || jsonb_build_object('registered', btrim(coalesce(value->>'name','')) <> '') order by ord) into v_old_teams from jsonb_array_elements(old.state->'teams') with ordinality as t(value,ord);
select jsonb_agg((value - array['name','losses','byes','initialByes','fairByes','technicalByes','out','updatedAt']::text[]) || jsonb_build_object('registered', btrim(coalesce(value->>'name','')) <> '') order by ord) into v_new_teams from jsonb_array_elements(v_state->'teams') with ordinality as t(value,ord);
if v_old_teams is distinct from v_new_teams then raise exception 'tournament_roster_locked' using errcode = '22023'; end if;
select coalesce(jsonb_agg((value - array['sets','winnerId','loserId','updatedAt','groupRound']::text[]) || jsonb_build_object('groupRound', nullif(value->>'groupRound', '0')) order by value->>'id'), '[]'::jsonb) into v_old_initial from jsonb_array_elements(old.state->'matches') where value->>'stage' = '0';
select coalesce(jsonb_agg((value - array['sets','winnerId','loserId','updatedAt','groupRound']::text[]) || jsonb_build_object('groupRound', nullif(value->>'groupRound', '0')) order by value->>'id'), '[]'::jsonb) into v_new_initial from jsonb_array_elements(v_state->'matches') where value->>'stage' = '0';
if v_old_initial is distinct from v_new_initial then raise exception 'tournament_draw_locked' using errcode = '22023'; end if;
end if; end if; if jsonb_array_length(v_state->'matches') > 0 then
v_started := coalesce(v_started, nullif(v_state #>> '{metadata,startedAt}', ''), nullif(v_state #>> '{settings,draw,generatedAt}', ''), nullif(v_state #>> '{metadata,createdAt}', ''), to_jsonb(now()) #>> '{}');
new.state := jsonb_set(v_state, '{metadata,startedAt}', to_jsonb(v_started), true); end if; return new;
end; $guard_reset$; revoke all on function private.guard_tournament_state() from public;
create or replace function public.reset_tournament_bracket( p_tournament_id uuid, p_expected_revision bigint
) returns public.tournaments language plpgsql
security definer set search_path = public, pg_temp as $reset_bracket$
declare v_row public.tournaments; v_state jsonb;
v_teams jsonb; v_now text := to_jsonb(now()) #>> '{}'; begin
if not private.is_tournament_owner(p_tournament_id) then raise exception 'owner_required' using errcode = '42501'; end if;
if p_expected_revision is null or p_expected_revision < 0 then raise exception 'revision_conflict' using errcode = '40001'; end if;
select * into v_row from public.tournaments where id = p_tournament_id for update; if not found or v_row.revision <> p_expected_revision then
raise exception 'revision_conflict' using errcode = '40001'; end if; if not private.is_tournament_owner(p_tournament_id) then
raise exception 'owner_required' using errcode = '42501'; end if; select jsonb_agg(value || jsonb_build_object(
'groupId', null, 'losses', 0, 'byes', 0, 'initialByes', 0, 'fairByes', 0, 'technicalByes', 0, 'out', false, 'updatedAt', v_now ) order by ord)
into v_teams from jsonb_array_elements(v_row.state->'teams') with ordinality as t(value,ord); v_state := v_row.state || jsonb_build_object( 'teams', v_teams, 'matches', '[]'::jsonb, 'groups', '[]'::jsonb,
'qualifiers', '[]'::jsonb, 'silverQualifiers', '[]'::jsonb, 'postseasonPlan', null, 'stage', -1, 'championId', null, 'silverChampionId', null, 'finalResetPlayed', false
); v_state := jsonb_set(v_state, '{metadata}', coalesce(v_state->'metadata','{}'::jsonb) || jsonb_build_object(
'startedAt', null, 'scheduleWarnings', '[]'::jsonb, 'updatedAt', v_now ), true); v_state := jsonb_set(v_state, '{settings,draw}',
coalesce(v_state #> '{settings,draw}','{}'::jsonb) || jsonb_build_object( 'code', null, 'generatedAt', null ), true);
v_state := jsonb_set(v_state, '{settings,byePolicy}', coalesce(v_state #> '{settings,byePolicy}','{}'::jsonb) || jsonb_build_object( 'cursor', 0, 'lastTeamId', null, 'history', '[]'::jsonb
), true); insert into private.bracket_reset_context( tournament_id, transaction_id, user_id, expected_revision, reset_state
) values (p_tournament_id, txid_current(), (select auth.uid()), p_expected_revision, v_state); update public.tournaments set state = v_state, public_read = false, revision = revision + 1, updated_at = now()
where id = p_tournament_id and revision = p_expected_revision returning * into v_row; if not found then
raise exception 'revision_conflict' using errcode = '40001'; end if; delete from private.bracket_reset_context where tournament_id = p_tournament_id;
return v_row; end; $reset_bracket$;
revoke all on function public.reset_tournament_bracket(uuid,bigint) from public, anon; grant execute on function public.reset_tournament_bracket(uuid,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
select case when to_regprocedure('public.create_tournament_draft(text,text,jsonb)') is not null and to_regprocedure('public.reset_tournament_bracket(uuid,bigint)') is not null then 'AGGIORNAMENTO_COMPLETATO' else 'VERIFICA_FUNZIONI' end as esito, to_regprocedure('public.create_tournament_draft(text,text,jsonb)') as bozza_privata, to_regprocedure('public.reset_tournament_bracket(uuid,bigint)') as elimina_tabellone;
-- FINE FILE COMPLETO: 00_AGGIORNAMENTO_SUPABASE.sql
