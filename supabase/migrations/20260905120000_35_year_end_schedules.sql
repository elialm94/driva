-- ============================================================================
-- 35 · Bokslutsbilagor
-- ----------------------------------------------------------------------------
-- En bokslutsbilaga är specifikationen bakom ett balanskonto: vad saldot
-- BESTÅR av. Revisorn frågar efter bilagan, inte efter kontot.
--
-- Tre bilagor kräver en uppgift som inte finns i bokföringen och som därför
-- lagras: antal sparade semesterdagar, bedömningen av vilka kundfordringar som
-- är osäkra, och hur stor avsättning till periodiseringsfond bolaget vill göra.
-- Resten räknas ur huvudboken varje gång bilagan visas.
--
-- lines och inputs är jsonb: specifikationens rader respektive de inmatade
-- uppgifterna. Formen skiljer sig per bilagetyp och beskrivs i
-- src/lib/types.ts (YearEndSchedule).
-- ============================================================================

create table if not exists public.year_end_schedules (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (
    kind in ('semesterloneskuld', 'kundfordringar_nedskrivning', 'periodiseringsfond')
  ),
  fiscal_year_id text not null,
  closing_amount bigint not null default 0,
  lines jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  status text not null check (status in ('utkast', 'bokford')),
  verification_ids jsonb not null default '[]'::jsonb,
  created_by text not null check (created_by in ('anvandare', 'assistent')),
  created_at timestamptz not null default now(),
  booked_at timestamptz
);

-- En bilaga per typ och räkenskapsår: två semesterlöneskulder för samma år
-- vore två svar på samma fråga.
create unique index if not exists year_end_schedules_kind_uq
  on public.year_end_schedules (business_id, fiscal_year_id, kind);
create index if not exists year_end_schedules_business_idx
  on public.year_end_schedules (business_id, fiscal_year_id, id);

grant select, insert, update, delete on public.year_end_schedules to driva_app;

alter table public.year_end_schedules enable row level security;
drop policy if exists year_end_schedules_tenant on public.year_end_schedules;
create policy year_end_schedules_tenant on public.year_end_schedules
  for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id));

comment on table public.year_end_schedules is
  'Bokslutsbilagor: specifikationen bakom semesterlöneskulden, nedskrivningen av kundfordringar och periodiseringsfonden.';

-- ---------------------------------------------------------------------------
-- Demoåterställningen måste tömma tabellen också.
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
  delete from public.payroll_runs where business_id = p_business_id;
  delete from public.employer_declarations where business_id = p_business_id;
  delete from public.employees where business_id = p_business_id;
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
  delete from public.year_end_schedules where business_id = p_business_id;
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
     set quote = 1, invoice = 1, verification = 1, verification_series = '{}'::jsonb
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
