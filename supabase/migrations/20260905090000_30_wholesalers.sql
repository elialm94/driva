-- ============================================================================
-- 30 · Grossistbeställningar (valfri funktion `wholesalers`)
-- ----------------------------------------------------------------------------
--   * wholesaler_connections: företagets grossister (kundnummer, ordermejl,
--     standardval, kundprisregel). Inaktivering är en flagga – aldrig radering.
--   * wholesaler_price_imports: importhistorik (status, antal, fel). Exakt en
--     aktiv import per anslutning pekas ut av connections.active_import_id.
--   * wholesaler_products: själva katalogen. Bor UTANFÖR tenantaggregatet
--     (laddas aldrig i sin helhet) och söks server-side med index på
--     normaliserade identifierare + trigram på söktexten.
--   * purchase_orders / purchase_order_lines: varukorg (draft) → skickad order.
--     sent_snapshot är det grossisten faktiskt fick och fryses vid utskick.
--   * purchase_order_confirmations: bekräftelser (flera per order, del-
--     bekräftelser, restorder) med rad-för-rad-avstämning.
--   * inbox_items: ny dokumenttyp orderbekraftelse + koppling till order.
--   * job_work_entries: källa wholesaler + proveniens (inköpskostnad i ören).
--
-- Pengar i grossisttabellerna är HELTALSÖREN (kolumner *_ore). Kundpriset som
-- når uppdraget följer appens befintliga modell (hela kronor per enhet).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- job_work_entries: grossistkälla + proveniens
-- ---------------------------------------------------------------------------
alter table public.job_work_entries drop constraint if exists job_work_entries_source_check;
alter table public.job_work_entries
  add constraint job_work_entries_source_check
  check (source in ('manual', 'quote', 'ai', 'import', 'wholesaler'));
alter table public.job_work_entries
  add column if not exists wholesaler_provenance jsonb;

-- ---------------------------------------------------------------------------
-- inbox_items: orderbekräftelser
-- ---------------------------------------------------------------------------
alter table public.inbox_items drop constraint if exists inbox_items_document_type_check;
alter table public.inbox_items
  add constraint inbox_items_document_type_check
  check (document_type in ('leverantorsfaktura', 'kvitto', 'ekonomiskt_dokument', 'orderbekraftelse'));
alter table public.inbox_items
  add column if not exists purchase_order_id text,
  add column if not exists purchase_order_confirmation_id text,
  add column if not exists purchase_order_candidates jsonb;

-- ---------------------------------------------------------------------------
-- wholesaler_connections
-- ---------------------------------------------------------------------------
create table if not exists public.wholesaler_connections (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  wholesaler text not null
    check (wholesaler in ('ahlsell', 'dahl', 'sonepar', 'solar', 'lundagrossisten', 'rexel', 'other')),
  display_name text,
  customer_number text not null default '',
  order_email text not null default '',
  cc_self boolean not null default false,
  default_delivery_mode text not null default 'pickup' check (default_delivery_mode in ('pickup', 'delivery')),
  default_store text,
  default_delivery_address text,
  contact_person text,
  phone text,
  customer_price_rule jsonb not null default '{"kind":"later"}'::jsonb,
  active boolean not null default true,
  active_import_id text,
  column_mapping jsonb,
  -- Rabattbrev: rabattgrupp → procent (jsonb-objekt), fylls av en rabattfil.
  discount_groups jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wholesaler_connections_business_idx
  on public.wholesaler_connections (business_id, created_at);

grant select, insert, update, delete on public.wholesaler_connections to driva_app;
alter table public.wholesaler_connections enable row level security;
drop policy if exists wholesaler_connections_select on public.wholesaler_connections;
create policy wholesaler_connections_select on public.wholesaler_connections
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists wholesaler_connections_insert on public.wholesaler_connections;
create policy wholesaler_connections_insert on public.wholesaler_connections
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists wholesaler_connections_update on public.wholesaler_connections;
create policy wholesaler_connections_update on public.wholesaler_connections
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists wholesaler_connections_delete on public.wholesaler_connections;
create policy wholesaler_connections_delete on public.wholesaler_connections
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- wholesaler_price_imports
-- ---------------------------------------------------------------------------
create table if not exists public.wholesaler_price_imports (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  connection_id text not null references public.wholesaler_connections (id) on delete cascade,
  filename text not null default '',
  file_kind text not null check (file_kind in ('csv', 'txt', 'xlsx', 'xml', 'zip')),
  status text not null check (status in ('processing', 'active', 'superseded', 'failed')),
  mapping jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  product_count integer not null default 0,
  skipped_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  has_article_register boolean not null default false,
  has_discounts boolean not null default false,
  discount_group_count integer not null default 0,
  price_date date not null,
  failed_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists wholesaler_price_imports_connection_idx
  on public.wholesaler_price_imports (business_id, connection_id, created_at desc);

grant select, insert, update, delete on public.wholesaler_price_imports to driva_app;
alter table public.wholesaler_price_imports enable row level security;
drop policy if exists wholesaler_price_imports_select on public.wholesaler_price_imports;
create policy wholesaler_price_imports_select on public.wholesaler_price_imports
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists wholesaler_price_imports_insert on public.wholesaler_price_imports;
create policy wholesaler_price_imports_insert on public.wholesaler_price_imports
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists wholesaler_price_imports_update on public.wholesaler_price_imports;
create policy wholesaler_price_imports_update on public.wholesaler_price_imports
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists wholesaler_price_imports_delete on public.wholesaler_price_imports;
create policy wholesaler_price_imports_delete on public.wholesaler_price_imports
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- wholesaler_products (katalogen – utanför aggregatet)
-- ---------------------------------------------------------------------------
create table if not exists public.wholesaler_products (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  connection_id text not null references public.wholesaler_connections (id) on delete cascade,
  import_id text not null references public.wholesaler_price_imports (id) on delete cascade,
  article_number text not null,
  name text not null,
  e_number text,
  rsk_number text,
  gtin text,
  category text,
  discount_group text,
  unit text not null default 'st',
  pack_size numeric check (pack_size is null or pack_size > 0),
  list_price_ore bigint check (list_price_ore is null or list_price_ore >= 0),
  discount_percent numeric check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  net_price_ore bigint check (net_price_ore is null or net_price_ore >= 0),
  net_price_source text check (net_price_source is null or net_price_source in ('file', 'discount_group')),
  sales_price_ore bigint check (sales_price_ore is null or sales_price_ore >= 0),
  -- Normaliserade söknycklar (små bokstäver, utan skiljetecken).
  article_key text not null,
  e_key text,
  rsk_key text,
  gtin_key text,
  name_key text not null default '',
  search_text text not null default ''
);

create index if not exists wholesaler_products_import_article_idx
  on public.wholesaler_products (business_id, import_id, article_key);
create index if not exists wholesaler_products_import_e_idx
  on public.wholesaler_products (business_id, import_id, e_key) where e_key is not null;
create index if not exists wholesaler_products_import_rsk_idx
  on public.wholesaler_products (business_id, import_id, rsk_key) where rsk_key is not null;
create index if not exists wholesaler_products_import_gtin_idx
  on public.wholesaler_products (business_id, import_id, gtin_key) where gtin_key is not null;
create index if not exists wholesaler_products_search_trgm_idx
  on public.wholesaler_products using gin (search_text gin_trgm_ops);

grant select, insert, update, delete on public.wholesaler_products to driva_app;
alter table public.wholesaler_products enable row level security;
drop policy if exists wholesaler_products_select on public.wholesaler_products;
create policy wholesaler_products_select on public.wholesaler_products
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists wholesaler_products_insert on public.wholesaler_products;
create policy wholesaler_products_insert on public.wholesaler_products
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists wholesaler_products_update on public.wholesaler_products;
create policy wholesaler_products_update on public.wholesaler_products
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists wholesaler_products_delete on public.wholesaler_products;
create policy wholesaler_products_delete on public.wholesaler_products
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- Same-business-invariant: importen och produkterna måste tillhöra samma
-- företag som anslutningen (FK:erna garanterar bara existens).
create or replace function app.assert_wholesaler_same_business()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.wholesaler_connections where id = new.connection_id;
  if v_business is null then
    raise exception 'wholesaler: anslutningen finns inte' using errcode = 'P0001';
  end if;
  if v_business is distinct from new.business_id then
    raise exception 'wholesaler: anslutningen tillhör ett annat företag' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists wholesaler_price_imports_same_business on public.wholesaler_price_imports;
create trigger wholesaler_price_imports_same_business
  before insert or update of connection_id, business_id on public.wholesaler_price_imports
  for each row execute function app.assert_wholesaler_same_business();

drop trigger if exists wholesaler_products_same_business on public.wholesaler_products;
create trigger wholesaler_products_same_business
  before insert or update of connection_id, business_id on public.wholesaler_products
  for each row execute function app.assert_wholesaler_same_business();

-- ---------------------------------------------------------------------------
-- purchase_orders
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  reference text not null,
  job_id text not null references public.jobs (id) on delete cascade,
  connection_id text not null references public.wholesaler_connections (id) on delete restrict,
  status text not null check (status in (
    'draft', 'sent', 'confirmed', 'partially_confirmed', 'needs_review', 'rejected', 'cancelled'
  )),
  channel text not null default 'email' check (channel in ('email', 'edi', 'api', 'punchout')),
  delivery jsonb not null default '{"mode":"pickup"}'::jsonb,
  orderer_name text not null default '',
  orderer_email text not null default '',
  orderer_phone text not null default '',
  message text,
  cc_self boolean not null default false,
  wholesaler_order_number text,
  sent_at timestamptz,
  sent_snapshot jsonb,
  last_email jsonb,
  last_send_attempt_at timestamptz,
  send_key text,
  created_by_user_id uuid,
  cancelled_at timestamptz,
  deviations_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_orders_reference_uq
  on public.purchase_orders (business_id, reference);
create index if not exists purchase_orders_job_idx
  on public.purchase_orders (business_id, job_id, created_at);
create index if not exists purchase_orders_wholesaler_number_idx
  on public.purchase_orders (business_id, wholesaler_order_number) where wholesaler_order_number is not null;

grant select, insert, update, delete on public.purchase_orders to driva_app;
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete on public.purchase_orders
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- Uppdrag och anslutning måste tillhöra samma företag som ordern.
create or replace function app.assert_purchase_order_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_business uuid;
  v_conn_business uuid;
begin
  select business_id into v_job_business from public.jobs where id = new.job_id;
  if v_job_business is null then
    raise exception 'purchase_order: uppdraget finns inte' using errcode = 'P0001';
  end if;
  if v_job_business is distinct from new.business_id then
    raise exception 'purchase_order: uppdraget tillhör ett annat företag' using errcode = 'P0001';
  end if;
  select business_id into v_conn_business from public.wholesaler_connections where id = new.connection_id;
  if v_conn_business is null then
    raise exception 'purchase_order: grossistanslutningen finns inte' using errcode = 'P0001';
  end if;
  if v_conn_business is distinct from new.business_id then
    raise exception 'purchase_order: grossistanslutningen tillhör ett annat företag' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_links on public.purchase_orders;
create trigger purchase_orders_links
  before insert or update of job_id, connection_id, business_id on public.purchase_orders
  for each row execute function app.assert_purchase_order_links();

-- Immutabilitet: det som skickats skrivs aldrig om. Utkast får tas bort,
-- skickade order aldrig (utom vid demoåterställning).
create or replace function app.purchase_orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.sent_at is not null and not app.demo_reset_active(old.business_id) then
      raise exception 'immutability: en skickad beställning kan inte tas bort – avbryt eller skapa en ny'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.sent_at is not null then
    if new.sent_at is distinct from old.sent_at
       or new.sent_snapshot is distinct from old.sent_snapshot
       or new.reference is distinct from old.reference
       or new.job_id is distinct from old.job_id
       or new.connection_id is distinct from old.connection_id
       or new.channel is distinct from old.channel then
      raise exception 'immutability: den skickade beställningen kan inte ändras – skapa en ny beställning'
        using errcode = 'P0001';
    end if;
    if new.status = 'draft' then
      raise exception 'immutability: en skickad beställning kan inte bli utkast igen'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_guard on public.purchase_orders;
create trigger purchase_orders_guard
  before update or delete on public.purchase_orders
  for each row execute function app.purchase_orders_guard();

-- ---------------------------------------------------------------------------
-- purchase_order_lines
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_order_lines (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id text not null references public.purchase_orders (id) on delete cascade,
  position integer not null default 0,
  product_id text,
  article_number text,
  name text not null default '',
  e_number text,
  rsk_number text,
  unit text not null default 'st',
  pack_size numeric check (pack_size is null or pack_size > 0),
  qty numeric not null check (qty > 0),
  unit_cost_ore bigint check (unit_cost_ore is null or unit_cost_ore >= 0),
  -- Kundpris i ören men alltid hela kronor (appens fakturamodell).
  customer_unit_price_ore bigint
    check (customer_unit_price_ore is null or (customer_unit_price_ore >= 0 and customer_unit_price_ore % 100 = 0)),
  customer_price_source text not null default 'missing'
    check (customer_price_source in ('explicit', 'file', 'markup', 'missing')),
  note text,
  is_free_text boolean not null default false,
  -- Materialraden på uppdraget (job_work_entries.id). Ingen FK: kopplingen ägs
  -- av domänlagret – tar användaren bort materialraden medvetet ska den inte
  -- återskapas av nästa bekräftelse.
  job_work_entry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_order_lines_order_idx
  on public.purchase_order_lines (business_id, order_id, position);
create unique index if not exists purchase_order_lines_work_entry_uq
  on public.purchase_order_lines (job_work_entry_id) where job_work_entry_id is not null;

grant select, insert, update, delete on public.purchase_order_lines to driva_app;
alter table public.purchase_order_lines enable row level security;
drop policy if exists purchase_order_lines_select on public.purchase_order_lines;
create policy purchase_order_lines_select on public.purchase_order_lines
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists purchase_order_lines_insert on public.purchase_order_lines;
create policy purchase_order_lines_insert on public.purchase_order_lines
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists purchase_order_lines_update on public.purchase_order_lines;
create policy purchase_order_lines_update on public.purchase_order_lines
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
drop policy if exists purchase_order_lines_delete on public.purchase_order_lines;
create policy purchase_order_lines_delete on public.purchase_order_lines
  for delete to driva_app, authenticated using (app.is_member(business_id));

-- Radens order måste tillhöra samma företag; skickade orderrader fryser
-- artikel/antal (kundpris och uppdragskoppling får uppdateras efteråt).
create or replace function app.purchase_order_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_business uuid;
  v_sent_at timestamptz;
begin
  if tg_op = 'DELETE' then
    select sent_at into v_sent_at from public.purchase_orders where id = old.order_id;
    if v_sent_at is not null and not app.demo_reset_active(old.business_id) then
      raise exception 'immutability: rader på en skickad beställning kan inte tas bort'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  select business_id, sent_at into v_business, v_sent_at from public.purchase_orders where id = new.order_id;
  if v_business is null then
    raise exception 'purchase_order_line: beställningen finns inte' using errcode = 'P0001';
  end if;
  if v_business is distinct from new.business_id then
    raise exception 'purchase_order_line: beställningen tillhör ett annat företag' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and v_sent_at is not null then
    if new.qty is distinct from old.qty
       or new.article_number is distinct from old.article_number
       or new.name is distinct from old.name
       or new.unit is distinct from old.unit
       or new.product_id is distinct from old.product_id
       or new.order_id is distinct from old.order_id then
      raise exception 'immutability: raderna på en skickad beställning kan inte ändras – skapa en ny beställning'
        using errcode = 'P0001';
    end if;
  end if;
  -- Aggregatets commit skriver "insert … on conflict do update": en befintlig
  -- rad går via UPDATE-grenen ovan, bara en NY rad på en skickad order stoppas.
  if tg_op = 'INSERT' and v_sent_at is not null and not app.demo_reset_active(new.business_id)
     and not exists (select 1 from public.purchase_order_lines l where l.id = new.id) then
    raise exception 'immutability: nya rader kan inte läggas på en skickad beställning'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_order_lines_guard on public.purchase_order_lines;
create trigger purchase_order_lines_guard
  before insert or update or delete on public.purchase_order_lines
  for each row execute function app.purchase_order_lines_guard();

-- ---------------------------------------------------------------------------
-- purchase_order_confirmations (historik – ingen DELETE)
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_order_confirmations (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id text not null references public.purchase_orders (id) on delete cascade,
  inbox_item_id text,
  source text not null check (source in ('email', 'manual', 'demo')),
  match_method text not null check (match_method in ('reference', 'order_number', 'customer_job', 'manual')),
  status text not null check (status in ('applied', 'needs_review', 'approved', 'dismissed')),
  received_at timestamptz not null,
  wholesaler_order_number text,
  delivery_date date,
  total_ore bigint check (total_ore is null or total_ore >= 0),
  message text,
  lines jsonb not null default '[]'::jsonb,
  deviations jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_confirmations_order_idx
  on public.purchase_order_confirmations (business_id, order_id, received_at);
-- Samma inkommande mejl ger aldrig två bekräftelser (idempotent återleverans).
create unique index if not exists purchase_order_confirmations_inbox_uq
  on public.purchase_order_confirmations (business_id, inbox_item_id) where inbox_item_id is not null;

grant select, insert, update on public.purchase_order_confirmations to driva_app;
alter table public.purchase_order_confirmations enable row level security;
drop policy if exists purchase_order_confirmations_select on public.purchase_order_confirmations;
create policy purchase_order_confirmations_select on public.purchase_order_confirmations
  for select to driva_app, authenticated using (app.is_member(business_id));
drop policy if exists purchase_order_confirmations_insert on public.purchase_order_confirmations;
create policy purchase_order_confirmations_insert on public.purchase_order_confirmations
  for insert to driva_app, authenticated with check (app.is_member(business_id));
drop policy if exists purchase_order_confirmations_update on public.purchase_order_confirmations;
create policy purchase_order_confirmations_update on public.purchase_order_confirmations
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));

create or replace function app.assert_confirmation_same_business()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.purchase_orders where id = new.order_id;
  if v_business is null then
    raise exception 'purchase_order_confirmation: beställningen finns inte' using errcode = 'P0001';
  end if;
  if v_business is distinct from new.business_id then
    raise exception 'purchase_order_confirmation: beställningen tillhör ett annat företag' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_order_confirmations_same_business on public.purchase_order_confirmations;
create trigger purchase_order_confirmations_same_business
  before insert or update of order_id, business_id on public.purchase_order_confirmations
  for each row execute function app.assert_confirmation_same_business();

-- ---------------------------------------------------------------------------
-- reset_demo_business: full kropp från 27 + grossisttabellerna.
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
  -- Grossist: bekräftelser → rader → order (connection_id är RESTRICT) →
  -- produkter → importer → anslutningar.
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
