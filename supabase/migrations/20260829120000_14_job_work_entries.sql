-- ============================================================================
-- 14 – Registrerat arbete på uppdrag (actuals ≠ offert ≠ faktura).
--
--   * planned = avtalad baseline kopierad från godkänd offert. Aldrig actuals.
--   * actual  = registrerad tid/material. Får överstiga offerten.
--   * invoice_id kopplar actuals till utkast/utfärdad faktura (ingen dubblett).
--   * Offertrader och fakturarader bor kvar i sina tabeller.
-- ============================================================================

create table public.job_work_entries (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  role text not null check (role in ('planned', 'actual')),
  type text not null check (type in ('labor', 'material', 'other')),
  description text not null default '',
  work_date date not null,
  qty numeric not null check (qty > 0),
  unit text not null default '',
  unit_price bigint not null check (unit_price >= 0),
  vat_rate integer not null check (vat_rate in (0, 6, 12, 25)),
  source text not null check (source in ('manual', 'quote', 'ai', 'import')),
  quoted_line_item_id text,
  is_extra boolean not null default false,
  invoice_id text references public.invoices (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_work_entries_job_idx
  on public.job_work_entries (job_id, role, work_date);
create index job_work_entries_business_idx
  on public.job_work_entries (business_id, created_at);
create index job_work_entries_invoice_idx
  on public.job_work_entries (invoice_id)
  where invoice_id is not null;

grant select, insert, update, delete on public.job_work_entries to driva_app;

alter table public.job_work_entries enable row level security;
create policy job_work_entries_select on public.job_work_entries
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy job_work_entries_insert on public.job_work_entries
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy job_work_entries_update on public.job_work_entries
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
create policy job_work_entries_delete on public.job_work_entries
  for delete to driva_app, authenticated
  using (app.is_member(business_id));
