-- ============================================================================
-- 23 · Demosessioner per besökare: tidsbegränsade, isolerade demoföretag
-- ----------------------------------------------------------------------------
-- Den publika demon byter modell från ETT delat demoföretag till ETT
-- demoföretag PER besökare (anonym Supabase-session äger sitt eget företag
-- via vanligt medlemskap – exakt samma auktorisering och RLS som riktiga
-- företag). Databasen får därför:
--
--   * businesses.demo_expires_at – när demoföretaget får städas bort.
--     Endast för is_demo-företag (CHECK). Kolumnen sätts vid INSERT och kan
--     därefter bara flyttas TIDIGARE (avsluta demo i förtid) – aldrig senare
--     och aldrig från null: en demosession kan inte förlänga sig själv, ens
--     via Data API:t (businesses_update-policyn tillåter medlemmar).
--   * app.delete_demo_business(uuid) – tar bort ETT utgånget demoföretag
--     atomärt: tömmer datat via samma väg som återställningen och raderar
--     sedan företagsraden (cascade tar medlemskap/inställningar/serier).
--     Hårda villkor i SQL: företaget måste vara skapat som demo (is_demo,
--     fryst av trigger sedan 19) OCH ha en passerad demo_expires_at.
--     Riktiga företag kan aldrig nås av den här vägen.
--   * app.reset_demo_business uppdateras: payment_files (tillkom efter 19)
--     töms nu också, annars kolliderar återimporten av exempeldatat.
-- ============================================================================

alter table public.businesses
  add column if not exists demo_expires_at timestamptz;

alter table public.businesses
  drop constraint if exists businesses_demo_expiry_only_for_demo;
alter table public.businesses
  add constraint businesses_demo_expiry_only_for_demo
  check (is_demo or demo_expires_at is null);

-- Cleanup-frågan: hitta utgångna demoföretag utan att skanna riktiga företag.
create index if not exists businesses_demo_expiry_idx
  on public.businesses (demo_expires_at)
  where is_demo;

-- ----------------------------------------------------------------------------
-- Frystrigger (ersätter 19-versionen): is_demo är oföränderlig, och
-- demo_expires_at får bara flyttas tidigare. Gäller alla roller och vägar –
-- även PostgREST-uppdateringar från en autentiserad demosession.
-- ----------------------------------------------------------------------------
create or replace function app.businesses_demo_flag_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_demo is distinct from old.is_demo then
    raise exception 'immutability: is_demo kan inte ändras efter att företaget skapats'
      using errcode = 'P0001';
  end if;
  if new.demo_expires_at is distinct from old.demo_expires_at then
    if old.demo_expires_at is null
       or new.demo_expires_at is null
       or new.demo_expires_at > old.demo_expires_at then
      raise exception 'immutability: demo_expires_at kan bara flyttas tidigare'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_demo_flag_frozen on public.businesses;
create trigger businesses_demo_flag_frozen
  before update on public.businesses
  for each row execute function app.businesses_demo_flag_frozen();

-- ----------------------------------------------------------------------------
-- Återställningen (full kropp från 19) + payment_files, som skapades i en
-- parallell migration och saknades i tömningslistan. Utan raden kolliderar
-- återimporten av exempeldatat på payment_files primärnyckel.
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
  delete from public.payment_files where business_id = p_business_id;
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
-- Borttagningen: raderar ETT utgånget demoföretag helt. Villkoren är
-- hårdkodade i SQL – is_demo (fryst sedan skapandet) OCH demo_expires_at
-- passerad – så ingen anropare, oavsett bugg, kan radera ett riktigt företag
-- eller en aktiv demosession den här vägen. Returnerar true när företaget
-- raderades, false när villkoren inte var uppfyllda.
-- ----------------------------------------------------------------------------
create or replace function app.delete_demo_business(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired boolean;
begin
  select b.demo_expires_at is not null and b.demo_expires_at < now()
    into v_expired
    from public.businesses b
   where b.id = p_business_id
     and b.is_demo;

  -- Finns inte / är inte demo / har ingen utgångstid / har inte gått ut.
  if v_expired is null or not v_expired then
    return false;
  end if;

  -- Tömningen återanvänder återställningsvägen: den öppnar demo-grinden
  -- (transaktionslokal GUC) och tar alla tabeller med immutabilitetstriggrar.
  perform app.reset_demo_business(p_business_id, null);

  -- Företagsraden sist: cascade tar medlemskap, inställningar, nummerserier
  -- och eventuella återstående företagsrader utan raderingsskydd.
  delete from public.businesses where id = p_business_id and is_demo;
  return true;
end;
$$;

revoke all on function app.delete_demo_business(uuid) from public;
grant execute on function app.delete_demo_business(uuid) to driva_app;
