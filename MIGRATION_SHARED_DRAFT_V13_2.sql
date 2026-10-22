-- Beach & Chill Glow Arena 13.2: bozze condivise fra admin, private per il pubblico.
-- Eseguire una volta (o di nuovo senza danni) nel SQL Editor di Supabase
-- PRIMA di pubblicare l'app 13.2. Richiede lo schema PRO v11 gia installato.
-- Non modifica dati, admin o visibilita dei tornei esistenti.
begin;

-- I valori delle righe esistenti rimangono invariati.
alter table public.tournaments alter column public_read set default false;

create or replace function public.create_tournament_draft(
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
  v_slug text := lower(trim(coalesce(p_slug, '')));
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

  -- Il trigger tournament_state_guard valida la bozza e i suoi partecipanti.
  -- Nessuna riga pubblica transitoria: creazione e iscrizione del proprietario
  -- fanno parte della stessa transazione RPC.
  insert into public.tournaments(name, slug, owner_id, public_read, state)
  values (trim(p_name), v_slug, v_user, false, p_state)
  returning * into v_row;

  insert into public.tournament_members(tournament_id, user_id, role)
  values (v_row.id, v_user, 'owner');

  return v_row;
exception
  when unique_violation then
    raise exception 'slug_already_exists' using errcode = '23505';
end;
$$;

revoke all on function public.create_tournament_draft(text, text, jsonb) from public, anon;
grant execute on function public.create_tournament_draft(text, text, jsonb) to authenticated;

-- Le policy esistenti gia consentono lettura e Realtime agli admin del torneo.
-- Pubblicazione e scrittura conservano i controlli owner/editor e di revisione.
notify pgrst, 'reload schema';
commit;
