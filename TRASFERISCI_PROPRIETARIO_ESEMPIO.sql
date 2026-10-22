-- ============================================================
-- Trasferisce il torneo esistente dal vecchio account Magic Link
-- al nuovo amministratore con username/password.
--
-- PRIMA DI ESEGUIRE:
-- 1. crea in Authentication → Users l'account tecnico
--    admin@admin.beachvolley.app con password e Auto Confirm;
-- 2. modifica qui sotto v_username e v_slug, se necessario.
-- ============================================================

do $$
declare
  v_username text := 'INSERISCI_USERNAME';
  v_slug text := 'INSERISCI_CHIAVE_TORNEO';
  v_new_owner uuid;
  v_tournament_id uuid;
begin
  if v_username = 'INSERISCI_USERNAME' or v_slug = 'INSERISCI_CHIAVE_TORNEO' then
    raise exception 'Compila v_username e v_slug prima di eseguire il trasferimento.';
  end if;
  select u.id into v_new_owner
  from auth.users u
  where lower(coalesce(u.email, '')) = lower(v_username) || '@admin.beachvolley.app'
  order by u.created_at asc
  limit 1;

  if v_new_owner is null then
    raise exception 'Nuovo amministratore non trovato: %', v_username;
  end if;

  select t.id into v_tournament_id
  from public.tournaments t
  where t.slug = v_slug
  limit 1;

  if v_tournament_id is null then
    raise exception 'Torneo non trovato con slug: %', v_slug;
  end if;

  delete from public.tournament_members
  where tournament_id = v_tournament_id
    and role = 'owner';

  update public.tournaments
  set owner_id = v_new_owner,
      updated_at = now()
  where id = v_tournament_id;

  insert into public.tournament_members(tournament_id, user_id, role)
  values (v_tournament_id, v_new_owner, 'owner')
  on conflict (tournament_id, user_id)
  do update set role = 'owner';
end $$;
