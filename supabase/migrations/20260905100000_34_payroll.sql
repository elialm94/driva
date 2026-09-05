-- ============================================================================
-- 34 · Lön och arbetsgivardeklaration
-- ----------------------------------------------------------------------------
-- Lönen är produktens första MÅNATLIGA myndighetsskyldighet: tolv tillfällen
-- om året där en missad arbetsgivardeklaration kostar pengar. Tre tabeller:
--
--   employees             den anställde (V1: en, ägaren) med fast månadslön
--   payroll_runs          bokförda lönekörningar, en per anställd och månad
--   employer_declarations arbetsgivardeklarationen (AGI) per månad
--
-- Beloppen på en lönekörning är frysta: verifikationen är oföränderlig, och
-- lönespecifikationen och deklarationen ska visa exakt det som bokfördes. Även
-- avgiftssatsen sparas, så historiken står kvar när lagen ändras.
--
-- tax_basis är jsonb därför att grunden är en av två former: Skatteverkets
-- skattetabell (tabellnummer + uppslaget avdrag + lönen uppslaget gjordes för)
-- eller en fast procentsats vid jämkning. Se src/lib/accounting/payroll-model.ts.
-- ============================================================================

create table if not exists public.employees (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  personnummer text not null,
  email text,
  role text not null check (role in ('foretagsledare', 'tjansteman')),
  monthly_salary bigint not null check (monthly_salary >= 0),
  tax_basis jsonb not null,
  start_date date not null,
  end_date date,
  status text not null check (status in ('anstalld', 'avslutad')),
  created_at timestamptz not null default now()
);

create index if not exists employees_business_idx on public.employees (business_id, created_at, id);

create table if not exists public.payroll_runs (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete cascade,
  -- Lönemånad, YYYY-MM.
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  pay_date date not null,
  gross bigint not null check (gross >= 0),
  tax bigint not null check (tax >= 0),
  net bigint not null,
  employer_contribution bigint not null check (employer_contribution >= 0),
  contribution_percent numeric(5, 2) not null check (contribution_percent >= 0),
  tax_basis jsonb not null,
  salary_account integer not null,
  verification_id text not null,
  created_by text not null check (created_by in ('anvandare', 'assistent')),
  created_at timestamptz not null default now()
);

-- En månad körs en gång per anställd: dubbel lön är inte en rättelse, det är fel.
create unique index if not exists payroll_runs_employee_month_uq
  on public.payroll_runs (business_id, employee_id, month);
create index if not exists payroll_runs_business_idx on public.payroll_runs (business_id, month, id);

create table if not exists public.employer_declarations (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  label text not null,
  status text not null check (status in ('utkast', 'deklarerad')),
  -- Individuppgifterna per anställd.
  individual_rows jsonb not null default '[]'::jsonb,
  gross bigint not null default 0,
  tax bigint not null default 0,
  employer_contribution bigint not null default 0,
  att_betala bigint not null default 0,
  due_date date not null,
  generated_at timestamptz not null default now(),
  declared_at timestamptz,
  tax_account_verification_id text
);

-- En deklaration per månad. Skatteverket har en per redovisningsperiod.
create unique index if not exists employer_declarations_month_uq
  on public.employer_declarations (business_id, month);

grant select, insert, update, delete on public.employees to driva_app;
grant select, insert, update, delete on public.payroll_runs to driva_app;
grant select, insert, update, delete on public.employer_declarations to driva_app;

alter table public.employees enable row level security;
drop policy if exists employees_tenant on public.employees;
create policy employees_tenant on public.employees
  for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id));

alter table public.payroll_runs enable row level security;
drop policy if exists payroll_runs_tenant on public.payroll_runs;
create policy payroll_runs_tenant on public.payroll_runs
  for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id));

alter table public.employer_declarations enable row level security;
drop policy if exists employer_declarations_tenant on public.employer_declarations;
create policy employer_declarations_tenant on public.employer_declarations
  for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id));

comment on table public.employees is
  'Anställda. V1: en anställd, ägaren med fast månadslön. Personnummret är känsligt och den enda källan för födelsedatumet som styr arbetsgivaravgiften.';
comment on table public.payroll_runs is
  'Bokförda lönekörningar. Beloppen är frysta – de speglar en oföränderlig verifikation.';
comment on table public.employer_declarations is
  'Arbetsgivardeklaration (AGI) per månad. Samma statusmaskin som momsrapporten: utkast ur bokföringen, sedan deklarerad med frysta siffror.';

-- ---------------------------------------------------------------------------
-- Demoåterställningen måste tömma de nya tabellerna också. Lönekörningarna
-- först: employee_id är FK mot employees.
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
