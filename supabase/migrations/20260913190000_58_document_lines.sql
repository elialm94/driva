-- ============================================================================
-- 58 – Dokumentrader (materialkedjan): artikelrader från kvitto/faktura,
-- inköpsreferens på uppdrag, kundprisregler, plus-tagg-kandidat.
--
--   * document_lines: operativa artikelrader, skilda från Expense/faktura.
--     Vidarefakturering skapar JobWorkEntry; closeout-allokeringen
--     (work_entry) är enda fakturamodellen. receipt_line finns kvar som
--     spårtyp men används inte parallellt.
--   * jobs.purchase_ref: stabil FV-referens, unik per företag.
--   * customers/jobs.material_price_rule: påslagshierarki.
--   * job_work_entries.document_line_id + document_line_allocation_id:
--     idempotens så samma dokumentrad inte skapar samma material två gånger.
--   * inbox_items.suggested_job_id: kandidat EFTER att tenant är känd.
--   * business_settings.low_material_margin_percent: varning, inte block.
-- Additivt. Ingen destruktiv reset. RLS + tenantisolering.
-- ============================================================================

alter table public.business_settings
  add column if not exists low_material_margin_percent integer;

alter table public.customers
  add column if not exists material_price_rule jsonb;

alter table public.jobs
  add column if not exists purchase_ref text,
  add column if not exists material_price_rule jsonb;

create unique index if not exists jobs_purchase_ref_uq
  on public.jobs (business_id, purchase_ref)
  where purchase_ref is not null;

alter table public.job_work_entries
  add column if not exists document_line_id text,
  add column if not exists document_line_allocation_id text;

create unique index if not exists job_work_entries_document_line_alloc_uq
  on public.job_work_entries (business_id, document_line_id, document_line_allocation_id)
  where document_line_id is not null and document_line_allocation_id is not null;

alter table public.inbox_items
  add column if not exists suggested_job_id text,
  add column if not exists job_match_method text;

alter table public.inbox_items drop constraint if exists inbox_items_job_match_method_check;
alter table public.inbox_items
  add constraint inbox_items_job_match_method_check
  check (job_match_method is null or job_match_method in (
    'plus_tag', 'subject_ref', 'document_ref', 'recent', 'supplier', 'order',
    'started_from_job', 'manual'
  ));

create table if not exists public.document_lines (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  source text not null check (source in ('receipt', 'supplier_invoice', 'order_confirmation', 'manual')),
  source_document_id text not null,
  source_index integer not null,
  inbox_item_id text,
  receipt_id text,
  expense_id text,
  supplier_invoice_id text,
  purchase_order_id text,
  purchase_order_confirmation_id text,
  raw jsonb not null default '{}'::jsonb,
  confirmed jsonb,
  article_number text,
  e_number text,
  rsk_number text,
  gtin text,
  qty numeric,
  unit text,
  unit_cost bigint,
  customer_price bigint,
  customer_price_source text,
  customer_price_rule jsonb,
  customer_price_explanation text,
  disposition text not null check (disposition in ('customer', 'company', 'private', 'ignored')),
  status text not null check (status in ('proposed', 'needs_review', 'confirmed', 'rejected')),
  allocations jsonb not null default '[]'::jsonb,
  field_confidence jsonb,
  math_ok boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create unique index if not exists document_lines_source_idx_uq
  on public.document_lines (business_id, source, source_document_id, source_index);

create index if not exists document_lines_inbox_idx
  on public.document_lines (business_id, inbox_item_id) where inbox_item_id is not null;

create index if not exists document_lines_expense_idx
  on public.document_lines (business_id, expense_id) where expense_id is not null;

grant select, insert, update, delete on public.document_lines to driva_app;

alter table public.document_lines enable row level security;
drop policy if exists document_lines_select on public.document_lines;
create policy document_lines_select on public.document_lines
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists document_lines_insert on public.document_lines;
create policy document_lines_insert on public.document_lines
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists document_lines_update on public.document_lines;
create policy document_lines_update on public.document_lines
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists document_lines_delete on public.document_lines;
create policy document_lines_delete on public.document_lines
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- Demo-reset: radera dokumentrader före uppdragsposter.
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
  delete from public.document_lines where business_id = p_business_id;
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
