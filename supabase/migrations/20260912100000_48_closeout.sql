-- ============================================================================
-- 48 – Avsluta uppdrag: faktureringsallokering, ändringar och tillägg,
-- betalplan med förskott, avslutsbeslut och kundvy.
--
--   * billing_allocations: spårbar länk källrad → fakturarad. EN levande
--     (draft/invoiced) allokering per källa – det unika indexet hindrar
--     dubbelfakturering oavsett vilket flöde som skapar fakturan.
--   * job_changes: ändringar/tillägg med kundgodkännande (namn + token +
--     tidsstämpel + contentHash + snapshot), samma bevismodell som offerten.
--   * jobs: avslutsbeslut (billing_deferrals), avslutstillstånd (closeout) och
--     kundvyns inställningar (customer_share + share_token för uppslag).
--   * invoice_line_items.source_kind: ny källa CHANGE_LINE.
--   * app.resolve_public_token: nya publika tokentyper job_change / job_share.
-- Allt är additivt. Befintliga rader påverkas inte.
-- ============================================================================

-- ------------------------------ Fakturarader --------------------------------

alter table public.invoice_line_items drop constraint if exists invoice_line_items_source_kind_check;
alter table public.invoice_line_items
  add constraint invoice_line_items_source_kind_check
  check (source_kind is null or source_kind in (
    'QUOTE_LINE', 'JOB_TIME_ENTRY', 'JOB_MATERIAL', 'JOB_OTHER', 'PAYMENT_PLAN', 'CHANGE_LINE', 'MANUAL'
  ));

-- --------------------------------- Uppdrag ----------------------------------

alter table public.jobs
  add column if not exists billing_deferrals jsonb,
  add column if not exists closeout jsonb,
  add column if not exists customer_share jsonb,
  add column if not exists share_token text;

create unique index if not exists jobs_share_token_uq
  on public.jobs (share_token) where share_token is not null;

-- --------------------------- Faktureringsallokering --------------------------

create table if not exists public.billing_allocations (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id text references public.jobs (id) on delete cascade,
  source_type text not null check (source_type in (
    'quote_line', 'payment_plan_part', 'quote_remainder', 'work_entry',
    'change_line', 'expense', 'receipt_line', 'manual'
  )),
  source_id text not null,
  invoice_id text not null references public.invoices (id) on delete cascade,
  invoice_line_id text not null,
  qty numeric,
  amount_excl_vat bigint not null default 0,
  status text not null check (status in ('draft', 'invoiced', 'released')),
  created_at timestamptz not null default now(),
  invoiced_at timestamptz,
  released_at timestamptz,
  release_reason text check (release_reason is null or release_reason in (
    'utkast_kastat', 'rad_borttagen', 'faktura_krediterad'
  )),
  constraint billing_allocations_release_consistent check (
    (status = 'released') = (released_at is not null)
  )
);

-- Hjärtat: en levande allokering per källa och företag.
create unique index if not exists billing_allocations_live_source_uq
  on public.billing_allocations (business_id, source_type, source_id)
  where status <> 'released';

-- En fakturarad kan bara bära en levande allokering.
create unique index if not exists billing_allocations_live_line_uq
  on public.billing_allocations (business_id, invoice_id, invoice_line_id)
  where status <> 'released';

create index if not exists billing_allocations_invoice_idx
  on public.billing_allocations (business_id, invoice_id);
create index if not exists billing_allocations_job_idx
  on public.billing_allocations (business_id, job_id) where job_id is not null;

grant select, insert, update, delete on public.billing_allocations to driva_app;

alter table public.billing_allocations enable row level security;
drop policy if exists billing_allocations_select on public.billing_allocations;
create policy billing_allocations_select on public.billing_allocations
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists billing_allocations_insert on public.billing_allocations;
create policy billing_allocations_insert on public.billing_allocations
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists billing_allocations_update on public.billing_allocations;
create policy billing_allocations_update on public.billing_allocations
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists billing_allocations_delete on public.billing_allocations;
create policy billing_allocations_delete on public.billing_allocations
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ---------------------------- Ändringar och tillägg ---------------------------

create table if not exists public.job_changes (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  number integer not null,
  version integer not null default 1,
  status text not null check (status in ('utkast', 'vantar_pa_kunden', 'godkand', 'avbojd', 'ersatt')),
  title text not null default '',
  description text not null default '',
  time_impact text,
  lines jsonb not null default '[]'::jsonb,
  token text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  decline_reason text,
  locked_at timestamptz,
  content_hash text,
  seller_snapshot jsonb,
  buyer_snapshot jsonb,
  approval jsonb,
  replaces_change_id text,
  replaced_by_change_id text,
  created_by text check (created_by is null or created_by in ('anvandare', 'assistent')),
  -- Godkänd = låst med hash och bevis. Aldrig godkänd utan låsning.
  constraint job_changes_approval_locked check (
    status <> 'godkand' or (approval is not null and locked_at is not null and content_hash is not null)
  )
);

create unique index if not exists job_changes_token_uq on public.job_changes (token);
create unique index if not exists job_changes_job_number_version_uq
  on public.job_changes (business_id, job_id, number, version);
create index if not exists job_changes_job_idx on public.job_changes (business_id, job_id, created_at);

grant select, insert, update, delete on public.job_changes to driva_app;

alter table public.job_changes enable row level security;
drop policy if exists job_changes_select on public.job_changes;
create policy job_changes_select on public.job_changes
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists job_changes_insert on public.job_changes;
create policy job_changes_insert on public.job_changes
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists job_changes_update on public.job_changes;
create policy job_changes_update on public.job_changes
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists job_changes_delete on public.job_changes;
create policy job_changes_delete on public.job_changes
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ------------------------------ Publika tokens -------------------------------

create or replace function app.resolve_public_token(p_kind text, p_token text)
returns table (business_id uuid, entity_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.business_id, q.id from public.quotes q
    where p_kind = 'quote' and q.token = p_token
  union all
  select i.business_id, i.id from public.invoices i
    where p_kind = 'invoice' and i.token = p_token
  union all
  select o.business_id, o.order_ref from public.bankid_orders o
    where p_kind = 'bankid_order' and o.order_ref = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website' and w.id = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website_slug' and w.slug = p_token
  union all
  select d.business_id, d.id from public.domains d
    where p_kind = 'hostname' and lower(d.hostname) = lower(p_token)
  union all
  select s.business_id, s.inbound_mail_slug
    from public.business_settings s
    where p_kind = 'inbound' and s.inbound_mail_slug = p_token
  union all
  select c.business_id, c.id from public.job_changes c
    where p_kind = 'job_change' and c.token = p_token
  union all
  select j.business_id, j.id from public.jobs j
    where p_kind = 'job_share' and j.share_token = p_token
  limit 1
$$;

revoke all on function app.resolve_public_token(text, text) from public;
grant execute on function app.resolve_public_token(text, text) to driva_app;

-- ------------------------------- Demo-reset ----------------------------------

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
  delete from public.billing_allocations where business_id = p_business_id;
  delete from public.invoice_issued_snapshots where business_id = p_business_id;
  delete from public.invoice_line_items where business_id = p_business_id;
  delete from public.invoices where business_id = p_business_id;
  delete from public.signatures where business_id = p_business_id;
  delete from public.bankid_orders where business_id = p_business_id;
  delete from public.quote_versions where business_id = p_business_id;
  delete from public.quotes where business_id = p_business_id;
  delete from public.purchase_order_confirmations where business_id = p_business_id;
  delete from public.purchase_order_lines where business_id = p_business_id;
  delete from public.purchase_orders where business_id = p_business_id;
  delete from public.wholesaler_products where business_id = p_business_id;
  delete from public.wholesaler_price_imports where business_id = p_business_id;
  delete from public.wholesaler_connections where business_id = p_business_id;
  delete from public.job_changes where business_id = p_business_id;
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
  delete from public.filing_submissions where business_id = p_business_id;
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
  delete from public.data_imports where business_id = p_business_id;
  delete from public.suppliers where business_id = p_business_id;
  update public.business_onboarding
     set status = 'complete', current_step = null, completed_at = coalesce(completed_at, now()),
         industries = '[]'::jsonb, other_industry = null, payroll = null, bookkeeping = null,
         task_overrides = '{}'::jsonb, updated_at = now()
   where business_id = p_business_id;
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
