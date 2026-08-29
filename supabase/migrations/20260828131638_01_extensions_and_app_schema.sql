-- ============================================================================
-- 01 · Extensions, privat "app"-schema, tenantkontext och applikationsroll
-- ----------------------------------------------------------------------------
-- Driva kör två datavägar mot Postgres:
--
--   1. Supabase Auth/PostgREST (rollen `authenticated`): används INTE för
--      tenantdata i appen i dag, men RLS-policyer finns på alla tabeller så
--      att Data API:t är säkert om det någonsin används. auth.uid() +
--      medlemskap i business_memberships styr åtkomst.
--
--   2. Serverprocessen (Next.js) via direkt Postgres-anslutning (pooler).
--      Rekommenderad roll: `driva_app` (NOBYPASSRLS). Servern sätter
--      `app.business_id` per transaktion efter att ha verifierat användarens
--      medlemskap via Supabase Auth. RLS släpper då bara igenom raderna för
--      exakt det företaget – skydd på djupet även om en WHERE-sats glöms.
--
-- Domänens id:n är TEXT (uuid-strängar + äldre seed-id:n som "cust-anna")
-- för att lokal data ska kunna migreras med bevarade id:n.
-- Pengar är HELA KRONOR (bigint) – aldrig ören, aldrig decimaler.
-- ============================================================================

-- gen_random_uuid() är inbyggt i PG13+ (pgcrypto behövs ändå för digest m.m.)
create extension if not exists pgcrypto;
-- Trigram-index för ilike-sökning i kundlistan.
create extension if not exists pg_trgm;

-- Privat schema för hjälpfunktioner och RPC:er. Exponeras INTE via Data API
-- (endast `public` är exponerat i config) – security definer-funktioner får
-- därmed inte anropas direkt av anon/authenticated via PostgREST.
create schema if not exists app;

-- ----------------------------------------------------------------------------
-- Applikationsroll för serverns direktanslutning.
-- Skapas UTAN lösenord (kan inte logga in förrän ägaren sätter ett):
--   alter role driva_app with password '...';  -- körs manuellt, aldrig i git
-- Faller ägaren tillbaka på `postgres`-användaren fungerar appen också, men
-- då är RLS förbikopplad på servervägen (appens egna guards gäller fortfarande).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'driva_app') then
    create role driva_app login nobypassrls;
  end if;
end
$$;

grant usage on schema public to driva_app;
grant usage on schema app to driva_app;

-- Låt ägarrollen växla till driva_app: servern kör `set local role driva_app`
-- i varje transaktion, så att RLS gäller ÄVEN om anslutnings-URL:en pekar på
-- postgres-användaren. (postgres skapade rollen och har admin option.)
grant driva_app to postgres;

-- ----------------------------------------------------------------------------
-- Tenantkontext: servern sätter app.business_id per transaktion via
--   select set_config('app.business_id', $1, true);
-- ----------------------------------------------------------------------------
create or replace function app.current_business_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.business_id', true), '')::uuid
$$;

grant execute on function app.current_business_id() to driva_app, authenticated;

-- app.is_member(uuid) – medlemskapskontrollen som alla RLS-policyer använder –
-- skapas i migration 02 efter att business_memberships finns (funktionskroppar
-- valideras vid CREATE).
