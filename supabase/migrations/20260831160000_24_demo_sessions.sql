-- ============================================================================
-- 24 · Isolerade demosessioner: varje besökare på /demo får ett EGET,
--      tidsbegränsat demoföretag i stället för det delade.
--
--   * businesses.demo_token_hash: SHA-256 av sessionens hemliga cookie-token.
--     Mappningen besökare ↔ demoföretag ligger alltså enbart på serversidan –
--     ett klientpåstått sessions-id räcker aldrig för att nå någon annans
--     session, och själva tokenvärdet lagras aldrig.
--   * businesses.demo_expires_at: sessionens hårda livslängd (24 h). Efter
--     den städas HELA företaget bort av cleanup-funktionen nedan.
--   * Per-sessionsföretag har INGEN rad i business_memberships: den delade
--     demo-användarens JWT ger därmed noll åtkomst via PostgREST/authenticated
--     (app.is_member kräver GUC-bundet företag eller medlemskap). Appvägen
--     (driva_app + app.business_id-GUC) auktoriseras i serverkoden via
--     token-uppslaget.
--   * app.cleanup_expired_demo_businesses raderar ENDAST rader med
--     is_demo = true AND demo_expires_at < now() – hårdkodat i funktionen.
--     Riktiga företag (is_demo = false) och det delade demoföretaget utan
--     demo_expires_at kan aldrig träffas.
-- ============================================================================

alter table public.businesses
  add column if not exists demo_token_hash text,
  add column if not exists demo_expires_at timestamptz;

-- Token-hash är sessionens nyckel – unik, och endast meningsfull för demo.
create unique index if not exists businesses_demo_token_hash_uq
  on public.businesses (demo_token_hash)
  where demo_token_hash is not null;

-- Cleanup-svepet: hitta utgångna demoföretag billigt.
create index if not exists businesses_demo_expires_idx
  on public.businesses (demo_expires_at)
  where is_demo;

-- ----------------------------------------------------------------------------
-- Städning av utgångna demosessioner.
--
-- Villkoret is_demo AND demo_expires_at < now() är hårdkodat – funktionen KAN
-- inte radera ett riktigt företag oavsett anropare. Tömningen går genom
-- app.reset_demo_business (samma immutabilitets-undantag som återställningen:
-- företagsraden måste finnas kvar och vara is_demo när barnen raderas – en
-- ren CASCADE från businesses hade fällts av triggrarna eftersom kaskaden
-- kör efter att företagsraden försvunnit). Därefter tas resterna och själva
-- företagsraden bort.
-- ----------------------------------------------------------------------------
create or replace function app.cleanup_expired_demo_businesses(p_limit integer default 25)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select b.id
      from public.businesses b
     where b.is_demo                       -- hårdkodat: aldrig riktiga företag
       and b.demo_expires_at is not null   -- delade/seedade demoföretag utan
       and b.demo_expires_at < now()       -- utgångstid lämnas orörda
     order by b.demo_expires_at
     limit greatest(coalesce(p_limit, 1), 1)
       for update skip locked
  loop
    -- Tömmer tenantdatat med demo-undantaget i immutabilitetstriggrarna.
    perform app.reset_demo_business(v_id, null);

    -- Resterna som återställningen medvetet lämnar kvar.
    delete from public.payment_files where business_id = v_id;
    -- Mejlloggen finns först efter migration 20 – hoppa över där den saknas
    -- (plpgsql binder tabellnamn först när satsen körs).
    if to_regclass('public.email_events') is not null then
      delete from public.email_events where business_id = v_id;
    end if;
    delete from public.business_memberships where business_id = v_id;

    -- Företagsraden sist: kvarvarande barn (settings, sequences) saknar
    -- immutabilitetstriggrar och följer med via ON DELETE CASCADE.
    delete from public.businesses where id = v_id and is_demo;

    return next v_id;
  end loop;
end;
$$;

revoke all on function app.cleanup_expired_demo_businesses(integer) from public;
grant execute on function app.cleanup_expired_demo_businesses(integer) to driva_app;
