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
-- app.reset_demo_business lärs om payment_files/email_events.
--
-- Funktionen skrevs i migration 19 innan tabellerna fanns (payment_files
-- sorterar efter i samma migrationsbatch, email_events kom i 20). driva_app
-- saknar medvetet delete-rätt på båda (append-only-artefakter), så tömningen
-- MÅSTE ske inne i security definer-funktionen. Kroppen är i övrigt identisk
-- med migration 19.
-- ----------------------------------------------------------------------------
create or replace function app.reset_demo_business(p_business_id uuid, p_keep_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.businesses b where b.id = p_business_id and b.is_demo
  ) then
    raise exception 'demo_reset: företaget är inte ett demoföretag' using errcode = 'P0001';
  end if;

  -- Transaktionslokal grind – endast raderingarna nedan passerar triggrarna.
  perform set_config('app.demo_reset', '1', true);

  -- Samma per-företags-lås som commit-vägen: pågående skrivningar serialiseras,
  -- och state_version-bumpen i slutet får deras CAS att ladda om mot tom bas.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 42));

  -- accounting_entries refererar verifications med ON DELETE RESTRICT –
  -- raderna måste bort först. Övriga tabeller täcks av CASCADE eller saknar
  -- inbördes RESTRICT-beroenden.
  delete from public.accounting_entries where business_id = p_business_id;
  delete from public.verifications where business_id = p_business_id;
  delete from public.payments where business_id = p_business_id;
  delete from public.invoice_issued_snapshots where business_id = p_business_id;
  delete from public.invoice_line_items where business_id = p_business_id;
  delete from public.invoices where business_id = p_business_id;
  delete from public.signatures where business_id = p_business_id;
  delete from public.bankid_orders where business_id = p_business_id;
  delete from public.quote_versions where business_id = p_business_id;
  delete from public.quotes where business_id = p_business_id;
  delete from public.job_work_entries where business_id = p_business_id;
  delete from public.jobs where business_id = p_business_id;
  delete from public.work_locations where business_id = p_business_id;
  delete from public.customers where business_id = p_business_id;
  delete from public.bank_transactions where business_id = p_business_id;
  delete from public.bank_accounts where business_id = p_business_id;
  delete from public.receipts where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.supplier_payments where business_id = p_business_id;
  delete from public.supplier_invoices where business_id = p_business_id;
  delete from public.vat_reports where business_id = p_business_id;
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
  delete from public.annual_reports where business_id = p_business_id;
  delete from public.fiscal_years where business_id = p_business_id;
  delete from public.websites where business_id = p_business_id;
  delete from public.domains where business_id = p_business_id;
  delete from public.assistant_messages where business_id = p_business_id;
  delete from public.pending_actions where business_id = p_business_id;
  delete from public.audit_log where business_id = p_business_id;
  delete from public.reminders where business_id = p_business_id;
  delete from public.attention_states where business_id = p_business_id;
  delete from public.inbox_items where business_id = p_business_id;
  delete from public.client_information_requests where business_id = p_business_id;
  delete from public.collaboration_invitations where business_id = p_business_id;
  -- Nytt mot migration 19: append-only-artefakterna. supplier_payments (FK:n
  -- mot payment_files) är redan raderade ovan.
  delete from public.payment_files where business_id = p_business_id;
  -- Mejlloggen finns först efter migration 20 – hoppa över där den saknas
  -- (plpgsql binder tabellnamn först när satsen körs).
  if to_regclass('public.email_events') is not null then
    delete from public.email_events where business_id = p_business_id;
  end if;

  -- Seedtillståndet har bara demo-ägaren som medlem. Utan detta skulle en
  -- accepterad demo-inbjudan ge kvarstående åtkomst efter återställningen.
  if p_keep_user_id is not null then
    update public.business_memberships
       set revoked_at = now()
     where business_id = p_business_id
       and revoked_at is null
       and user_id <> p_keep_user_id;
  end if;

  update public.business_sequences
     set quote = 1, invoice = 1, verification = 1
   where business_id = p_business_id;

  update public.businesses
     set state_version = state_version + 1,
         accounting_locked_through = null,
         meta = '{}'::jsonb
   where id = p_business_id;
end;
$$;

revoke all on function app.reset_demo_business(uuid, uuid) from public;
grant execute on function app.reset_demo_business(uuid, uuid) to driva_app;

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
