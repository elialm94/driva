-- ============================================================================
-- 14 – Leverantörsbetalningar + inbox som ekonomiskt underlag.
--
--   * AccountingStatus och PaymentStatus är separata: bokförd ≠ betald.
--   * supplier_payments är instruktionen mot banken (aldrig fejkad framgång).
--   * Inbox-poster får dokumenttyp och tolkade fakturafält.
-- ============================================================================

alter table public.supplier_invoices
  add column if not exists accounting_status text not null default 'obokford'
    check (accounting_status in ('obokford', 'bokford')),
  add column if not exists ocr text,
  add column if not exists bankgiro text,
  add column if not exists recipient_account text,
  add column if not exists inbox_item_id text;

update public.supplier_invoices
   set accounting_status = 'bokford'
 where verification_id is not null and accounting_status = 'obokford';

create table public.supplier_payments (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_invoice_id text not null references public.supplier_invoices (id) on delete cascade,
  amount bigint not null check (amount >= 1),
  currency text not null default 'SEK',
  due_date text not null,
  scheduled_date text not null,
  ocr text,
  reference text,
  recipient_account text not null,
  recipient_name text not null,
  provider_payment_id text,
  idempotency_key text not null,
  status text not null check (status in (
    'DRAFT', 'READY', 'SUBMITTED_TO_BANK', 'AWAITING_APPROVAL',
    'SCHEDULED', 'PAID', 'FAILED', 'CANCELLED'
  )),
  failure_reason text,
  destination_changed boolean not null default false,
  bank_transaction_id text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index supplier_payments_idempotency_uq
  on public.supplier_payments (business_id, idempotency_key);

create unique index supplier_payments_provider_uq
  on public.supplier_payments (business_id, provider_payment_id)
  where provider_payment_id is not null;

create unique index supplier_payments_active_invoice_uq
  on public.supplier_payments (business_id, supplier_invoice_id)
  where status in ('DRAFT', 'READY', 'SUBMITTED_TO_BANK', 'AWAITING_APPROVAL', 'SCHEDULED');

create index supplier_payments_business_status_idx
  on public.supplier_payments (business_id, status, scheduled_date);

grant select, insert, update on public.supplier_payments to driva_app;

alter table public.supplier_payments enable row level security;
create policy supplier_payments_select on public.supplier_payments
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy supplier_payments_insert on public.supplier_payments
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy supplier_payments_update on public.supplier_payments
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));

-- Inbox: ekonomiskt underlag, inte hemsideförfrågningar.
alter table public.inbox_items
  drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items
  add constraint inbox_items_kind_check check (kind in ('mail', 'uppladdning'));

alter table public.inbox_items
  add column if not exists document_type text not null default 'ekonomiskt_dokument'
    check (document_type in ('leverantorsfaktura', 'kvitto', 'ekonomiskt_dokument')),
  add column if not exists source text,
  add column if not exists parsed_invoice_number text,
  add column if not exists parsed_due_date date,
  add column if not exists parsed_ocr text,
  add column if not exists parsed_bankgiro text,
  add column if not exists supplier_invoice_id text;
