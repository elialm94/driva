-- ============================================================================
-- 30 · Kontoregister (kontoplanen som data)
-- ----------------------------------------------------------------------------
-- Kontoplanen var tidigare en hårdkodad lista med 43 konton i koden, och
-- bokföringsmotorn avvisade allt annat. Registret består nu av två lager:
--
--   1. Standardplanen (BAS) ligger kvar i koden. Den är versionerad, testad
--      och identisk för alla företag – den kopieras därför INTE per företag.
--   2. chart_accounts: företagets avvikelser. Ett eget konto, ett omdöpt
--      konto eller ett arkiverat konto. Bara avvikelser lagras, så tabellen
--      är tom för ett företag som kör på standardplanen.
--
-- Konsekvens: ingen backfill av de 43 gamla kontona behövs. De finns alla i
-- standardplanen med exakt samma namn som förut, och bokförda verifikationer
-- bär dessutom sitt kontonamn i accounting_entries.account_name – historiken
-- läses likadant oavsett hur registret ändras framåt.
--
-- `section` är kontots post i resultat- eller balansräkningen enligt K2, så
-- att rapporterna kan byggas strukturellt i stället för på nummerintervall.
-- ============================================================================

create table if not exists public.chart_accounts (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- BAS:s nummerrymd. Fyrsiffrigt så att kontot kan placeras i rapporterna.
  number integer not null check (number between 1000 and 8999),
  name text not null check (length(trim(name)) > 0),
  type text not null check (type in ('tillgang', 'eget_kapital', 'skuld', 'intakt', 'kostnad')),
  section text not null,
  -- Sant när kontot inte finns i standardplanen (företagets eget konto).
  custom boolean not null default false,
  -- Arkiverat konto tar inte emot nya konteringar. Historiken påverkas aldrig.
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Ett konto per nummer och företag: registret kan inte innehålla två
-- versioner av samma konto.
create unique index if not exists chart_accounts_business_number_uq
  on public.chart_accounts (business_id, number);

grant select, insert, update, delete on public.chart_accounts to driva_app;

alter table public.chart_accounts enable row level security;
drop policy if exists chart_accounts_server on public.chart_accounts;
create policy chart_accounts_server on public.chart_accounts
  for all to driva_app using (app.is_member(business_id)) with check (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- Demoåterställning tömmer även registret, annars följer egna konton med in i
-- ett nyseedat demoföretag. Full kropp från 27 + chart_accounts.
-- ---------------------------------------------------------------------------
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

  perform set_config('app.demo_reset', '1', true);
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 42));

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
  delete from public.bank_connections where business_id = p_business_id;
  delete from public.receipts where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.supplier_payments where business_id = p_business_id;
  delete from public.supplier_invoices where business_id = p_business_id;
  delete from public.payment_files where business_id = p_business_id;
  delete from public.vat_reports where business_id = p_business_id;
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
  delete from public.annual_reports where business_id = p_business_id;
  delete from public.chart_accounts where business_id = p_business_id;
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
