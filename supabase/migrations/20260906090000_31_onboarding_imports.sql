-- ============================================================================
-- 31 · Onboarding, Kom igång och dataimport
-- ----------------------------------------------------------------------------
--   * business_onboarding: onboardingens tillstånd per företag (steg 1 skapar
--     företaget, steg 2 personaliserar) + Kom igång-profilen (bransch, lön,
--     bokföringssituation) + de få uppgiftsval som inte kan härledas ur data
--     ("gör senare", "behövs inte"). Befintliga företag backfillas som klara.
--   * data_imports: audit av genomförda/misslyckade importer (fil-hash,
--     antal, varningar, val). Filerna själva sparas inte.
--   * suppliers: leverantörsregister (importerat eller manuellt).
--   * app.import_verification: bokför en verifikation från en SIE-import med
--     filens egen serie + nummer (unikt index skyddar), samma radvalidering
--     som app.post_verification, och flyttar fram nummerserien så nya
--     verifikationer aldrig kolliderar. Ingen CAS: numret kommer från filen.
--   * verifications.source_type får värdet 'sie_import'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- business_onboarding
-- ---------------------------------------------------------------------------
create table if not exists public.business_onboarding (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  status text not null check (status in ('not_started', 'company_done', 'complete')),
  current_step text check (current_step is null or current_step in ('company', 'personalize')),
  started_at timestamptz not null default now(),
  company_completed_at timestamptz,
  personalization_completed_at timestamptz,
  completed_at timestamptz,
  -- ["el","vvs",…] – typade värden valideras i domänlagret; jsonb för flera val.
  industries jsonb not null default '[]'::jsonb,
  other_industry text,
  payroll text check (payroll is null or payroll in ('none', 'owner', 'employees', 'later')),
  bookkeeping text check (bookkeeping is null or bookkeeping in ('existing', 'new', 'consultant', 'later')),
  -- {"connect_bank": {"state":"later","at":"…"}} – bara det som inte kan härledas.
  task_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.business_onboarding to driva_app;
alter table public.business_onboarding enable row level security;
drop policy if exists business_onboarding_select on public.business_onboarding;
create policy business_onboarding_select on public.business_onboarding
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists business_onboarding_insert on public.business_onboarding;
create policy business_onboarding_insert on public.business_onboarding
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists business_onboarding_update on public.business_onboarding;
create policy business_onboarding_update on public.business_onboarding
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists business_onboarding_delete on public.business_onboarding;
create policy business_onboarding_delete on public.business_onboarding
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- Backfill: alla företag som finns när migrationen körs är klara med
-- onboarding – ingen befintlig kund tvingas igenom de nya frågorna.
insert into public.business_onboarding (
  business_id, status, current_step, started_at, company_completed_at,
  personalization_completed_at, completed_at, updated_at
)
select b.id, 'complete', null, b.created_at, b.created_at, b.created_at, b.created_at, now()
  from public.businesses b
 where not exists (select 1 from public.business_onboarding o where o.business_id = b.id);

-- ---------------------------------------------------------------------------
-- data_imports
-- ---------------------------------------------------------------------------
create table if not exists public.data_imports (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('bokforing', 'kunder', 'leverantorer', 'artiklar')),
  status text not null check (status in ('imported', 'failed')),
  filename text not null default '',
  file_kind text not null default '',
  file_hash text not null,
  file_size integer not null default 0,
  user_id uuid,
  choices jsonb,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  ignored_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  summary text not null default '',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Samma fil (hash) importeras aldrig två gånger av misstag för samma ändamål.
create unique index if not exists data_imports_business_hash_uq
  on public.data_imports (business_id, kind, file_hash) where status = 'imported';
create index if not exists data_imports_business_idx
  on public.data_imports (business_id, created_at desc);

grant select, insert, update, delete on public.data_imports to driva_app;
alter table public.data_imports enable row level security;
drop policy if exists data_imports_select on public.data_imports;
create policy data_imports_select on public.data_imports
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists data_imports_insert on public.data_imports;
create policy data_imports_insert on public.data_imports
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists data_imports_update on public.data_imports;
create policy data_imports_update on public.data_imports
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists data_imports_delete on public.data_imports;
create policy data_imports_delete on public.data_imports
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  org_number text,
  email text,
  phone text,
  address text,
  postal_code text,
  city text,
  bankgiro text,
  plusgiro text,
  bank_account text,
  iban text,
  notes text,
  source text not null default 'manuell' check (source in ('import', 'manuell')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_business_name_idx on public.suppliers (business_id, lower(name));

grant select, insert, update, delete on public.suppliers to driva_app;
alter table public.suppliers enable row level security;
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- app.import_verification: SIE-import med filens serie + nummer
-- ---------------------------------------------------------------------------
create or replace function app.import_verification(p_business_id uuid, p_verification jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer := (p_verification ->> 'number')::integer;
  v_series text := coalesce(p_verification ->> 'series', 'A');
  v_entry jsonb;
  v_pos integer := 0;
begin
  if v_number is null or v_number < 1 then
    raise exception 'import_ogiltig: verifikationen saknar nummer' using errcode = 'P0001';
  end if;
  if coalesce(p_verification ->> 'source_type', '') <> 'sie_import' then
    raise exception 'import_ogiltig: bara SIE-importer får behålla eget nummer' using errcode = 'P0001';
  end if;
  -- Samma balans- och radkrav som all annan bokföring.
  perform app.validate_entries(p_verification -> 'entries');

  insert into public.verifications (
    id, business_id, series, number, date, description,
    source_type, source_id, confidence, created_by, status, posted_at,
    fiscal_year_id, corrects_verification_id, explanation, created_at
  ) values (
    p_verification ->> 'id',
    p_business_id,
    v_series,
    v_number,
    p_verification ->> 'date',
    coalesce(p_verification ->> 'description', ''),
    'sie_import',
    p_verification ->> 'source_id',
    coalesce(p_verification ->> 'confidence', 'hog'),
    coalesce(p_verification ->> 'created_by', 'anvandare'),
    'bokford',
    (p_verification ->> 'posted_at')::timestamptz,
    p_verification ->> 'fiscal_year_id',
    null,
    p_verification ->> 'explanation',
    coalesce((p_verification ->> 'created_at')::timestamptz, now())
  );

  for v_entry in select * from jsonb_array_elements(p_verification -> 'entries') loop
    insert into public.accounting_entries (
      verification_id, business_id, position, account, account_name,
      debit, credit, vat_code, note
    ) values (
      p_verification ->> 'id',
      p_business_id,
      v_pos,
      (v_entry ->> 'account')::integer,
      coalesce(v_entry ->> 'account_name', ''),
      coalesce((v_entry ->> 'debit')::bigint, 0),
      coalesce((v_entry ->> 'credit')::bigint, 0),
      v_entry ->> 'vat_code',
      v_entry ->> 'note'
    );
    v_pos := v_pos + 1;
  end loop;

  -- Serie A delar nummerserie med appens egna verifikationer: flytta fram
  -- nästa lediga nummer så inget nytt någonsin får ett importerat nummer.
  if v_series = 'A' then
    update public.business_sequences
       set verification = greatest(verification, v_number + 1)
     where business_id = p_business_id;
  end if;
end;
$$;

revoke all on function app.import_verification(uuid, jsonb) from public;
grant execute on function app.import_verification(uuid, jsonb) to driva_app;

-- ---------------------------------------------------------------------------
-- Demo-reset: töm även de nya tabellerna
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
  delete from public.purchase_order_confirmations where business_id = p_business_id;
  delete from public.purchase_order_lines where business_id = p_business_id;
  delete from public.purchase_orders where business_id = p_business_id;
  delete from public.wholesaler_products where business_id = p_business_id;
  delete from public.wholesaler_price_imports where business_id = p_business_id;
  delete from public.wholesaler_connections where business_id = p_business_id;
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
  -- Demoföretaget är alltid klart med onboarding – raden återställs till klar.
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
