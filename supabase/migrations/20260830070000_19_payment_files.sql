-- ============================================================================
-- 19 – Bankfiler (pain.001) + granskningsbara tolkningsfält + betalkonto.
--
--   * payment_files: genererad ISO 20022 pain.001-XML med metadata. Filen är
--     en INSTRUKTION – aldrig ett bevis på att banken tagit emot något.
--   * supplier_payments får status PAYMENT_FILE_CREATED (fil skapad, ej
--     skickad) + FK till aktiv bankfil. Dubbelbetalningsskydd: det partiella
--     unika indexet räknar även PAYMENT_FILE_CREATED som aktiv.
--   * inbox_items.extraction (jsonb): per-fält värde + konfidens + källa så
--     att "Kontrollera belopp" kan visa exakt vad Driva läst. reviewed_at
--     sätts när användaren godkänt uppgifterna.
--   * business_settings får företagets betalkonto (payer_*) – det konto
--     pain.001-debitorn använder. Skiljer sig från bankgiro (inbetalningar).
-- ============================================================================

create table public.payment_files (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  filename text not null,
  message_id text not null,
  format text not null check (format in ('ISO20022_PAIN001')),
  payment_ids jsonb not null default '[]'::jsonb,
  supplier_invoice_ids jsonb not null default '[]'::jsonb,
  total_amount bigint not null check (total_amount >= 1),
  currency text not null default 'SEK',
  xml text not null,
  status text not null check (status in ('CREATED', 'REPLACED', 'CANCELLED')),
  replaced_by_file_id text,
  created_at timestamptz not null default now(),
  created_by text not null default 'anvandare' check (created_by in ('anvandare', 'assistent'))
);

-- MsgId ska vara unik per företag (bankernas dubblettkontroll utgår från den).
create unique index payment_files_message_id_uq
  on public.payment_files (business_id, message_id);

create index payment_files_business_status_idx
  on public.payment_files (business_id, status, created_at);

grant select, insert, update on public.payment_files to driva_app;

alter table public.payment_files enable row level security;
create policy payment_files_select on public.payment_files
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy payment_files_insert on public.payment_files
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy payment_files_update on public.payment_files
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));

-- Betalningsinstruktioner: ny status + koppling till aktiv bankfil.
alter table public.supplier_payments
  drop constraint if exists supplier_payments_status_check;
alter table public.supplier_payments
  add constraint supplier_payments_status_check check (status in (
    'DRAFT', 'READY', 'PAYMENT_FILE_CREATED', 'SUBMITTED_TO_BANK',
    'AWAITING_APPROVAL', 'SCHEDULED', 'PAID', 'FAILED', 'CANCELLED'
  ));

alter table public.supplier_payments
  add column if not exists payment_file_id text references public.payment_files (id);

-- En faktura får bara ha EN aktiv instruktion – inklusive fil-skapad-status.
drop index if exists supplier_payments_active_invoice_uq;
create unique index supplier_payments_active_invoice_uq
  on public.supplier_payments (business_id, supplier_invoice_id)
  where status in (
    'DRAFT', 'READY', 'PAYMENT_FILE_CREATED', 'SUBMITTED_TO_BANK',
    'AWAITING_APPROVAL', 'SCHEDULED'
  );

-- Tolkningens per-fält-proveniens + användarens godkännandestämpel.
alter table public.inbox_items
  add column if not exists extraction jsonb,
  add column if not exists reviewed_at timestamptz;

-- Företagets betalkonto för utgående betalningar (pain.001-debitor).
alter table public.business_settings
  add column if not exists payer_bank_name text,
  add column if not exists payer_iban text,
  add column if not exists payer_bic text;
