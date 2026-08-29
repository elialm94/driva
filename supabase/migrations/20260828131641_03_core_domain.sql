-- ============================================================================
-- 03 · Kärndomän: kunder, bostäder, förfrågningar, offerter, BankID,
--      uppdrag, fakturor, betalningar
-- ----------------------------------------------------------------------------
-- Designprinciper:
--   * Entitets-id:n är TEXT (uuid-strängar; äldre seed-id:n som "cust-anna"
--     bevaras vid migrering av lokal data).
--   * Frågerelevanta fält = riktiga kolumner. Djupa värdeobjekt = JSONB.
--   * quote_versions.payload är hash-fryst yta: exakt fältuppsättning enligt
--     src/lib/hash.ts. Lagras verbatim som JSONB och får ALDRIG normaliseras –
--     gamla BankID-signaturer måste hasha identiskt efter migrering.
--   * invoice_issued_snapshots är den juridiska kopian av utfärdad faktura –
--     egen tabell (håller fakturaraderna smala) och oföränderlig via trigger.
--   * Belopp: bigint, hela kronor. qty kan vara decimal (t.ex. timmar).
-- ============================================================================

-- --------------------------------- Kunder ----------------------------------

create table public.customers (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('privat', 'foretag')),
  name text not null,
  contact_person text,
  org_number text,
  email text not null default '',
  phone text not null default '',
  address text,
  postal_code text,
  city text,
  -- Personnummer för ROT/RUT. Känsligt: maskas i alla vanliga vyer, skickas
  -- aldrig till LLM, loggas aldrig. Endast servern (driva_app) läser kolumnen;
  -- Data API-läsning stoppas av RLS + att appen aldrig exponerar fältet.
  -- Kryptering i vila: Postgres-alternativ dokumenteras i README (pgcrypto/
  -- pgsodium/KMS) – ingen hemmagjord kryptering i applikationslagret.
  personal_identity_number text,
  default_work_location_id text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index customers_business_created_idx on public.customers (business_id, created_at desc);
create index customers_name_trgm_idx on public.customers using gin (name gin_trgm_ops);

-- Bostäder/arbetsplatser. ROT-uppgifter (beteckning/BRF) bor här,
-- personnummer på kunden. position = visningsordning.
create table public.work_locations (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  position integer not null default 0,
  label text not null default '',
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  place_id text,
  property_type text not null check (property_type in ('smahus', 'bostadsratt')),
  property_designation text,
  brf_org_number text,
  apartment_number text
);

create index work_locations_customer_idx on public.work_locations (customer_id);
create index work_locations_business_idx on public.work_locations (business_id);

-- ------------------------------ Förfrågningar ------------------------------

create table public.requests (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  title text not null default '',
  message text not null default '',
  source text not null check (source in ('hemsida', 'email', 'telefon', 'manuell', 'assistent')),
  status text not null check (status in ('ny', 'offert_skapad', 'besvarad', 'avslutad')),
  quote_id text,
  -- Klientnyckel: refresh/dubbelklick på kontaktformuläret skapar aldrig dubletter.
  idempotency_key text,
  notification jsonb,
  ai jsonb,
  created_at timestamptz not null default now()
);

create unique index requests_idempotency_uq on public.requests (business_id, idempotency_key)
  where idempotency_key is not null;
create index requests_business_status_idx on public.requests (business_id, status);
create index requests_customer_idx on public.requests (customer_id);

-- -------------------------------- Offerter ---------------------------------

create table public.quotes (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  number integer not null,
  customer_id text not null references public.customers (id) on delete cascade,
  request_id text,
  job_id text,
  status text not null check (status in ('utkast', 'skickad', 'godkand', 'avbojd', 'utgangen')),
  current_version_id text not null,
  -- Publik, ogissbar token för kundlänken /offert/[token].
  token text not null,
  sent_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  decline_reason text,
  follow_ups jsonb not null default '[]'::jsonb,
  -- Denormaliserat att-betala-belopp (aktuell version) för listor/summeringar.
  -- Skrivs av applikationen tillsammans med versionen – härledd data, aldrig
  -- källa till sanning.
  amount_to_pay bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index quotes_business_number_uq on public.quotes (business_id, number);
create unique index quotes_token_uq on public.quotes (token);
create index quotes_business_status_idx on public.quotes (business_id, status);
create index quotes_customer_idx on public.quotes (customer_id);

-- Offertversion. payload = hela QuoteVersion-objektet minus extraherade
-- kolumner nedan? NEJ – payload är HELA objektet verbatim (inkl. id/quoteId),
-- så att laddning är en ren passthrough och hash-ytan aldrig kan glida.
create table public.quote_versions (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  quote_id text not null references public.quotes (id) on delete cascade,
  version integer not null,
  title text not null default '',
  -- Sätts när versionen låses vid BankID-godkännande. Låsta versioner är
  -- oföränderliga (trigger i 06) – rättelser = ny version.
  locked_at timestamptz,
  content_hash text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create unique index quote_versions_quote_version_uq on public.quote_versions (quote_id, version);
create index quote_versions_business_idx on public.quote_versions (business_id);

-- --------------------------------- BankID ----------------------------------

create table public.bankid_orders (
  order_ref text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  quote_id text not null references public.quotes (id) on delete cascade,
  quote_version_id text not null,
  status text not null check (status in ('pending', 'complete', 'failed')),
  hint_code text not null,
  method text not null check (method in ('same_device', 'qr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bankid_orders_quote_idx on public.bankid_orders (quote_id);

-- En offert kan bara ha EN signatur (unikt index = dubbelgodkännande är
-- omöjligt även vid samtidiga collect-anrop).
create table public.signatures (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  quote_id text not null references public.quotes (id) on delete cascade,
  quote_version_id text not null,
  order_ref text not null,
  signer_name text not null,
  signer_personal_number_masked text not null,
  signed_at timestamptz not null,
  environment text not null check (environment in ('mock', 'production')),
  evidence jsonb not null
);

create unique index signatures_quote_uq on public.signatures (quote_id);

-- --------------------------------- Uppdrag ---------------------------------

create table public.jobs (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  quote_id text,
  title text not null default '',
  description text not null default '',
  status text not null check (status in ('kommande', 'pagar', 'klart')),
  -- Blandade strängformat (seed: full ISO, formulär: YYYY-MM-DD) – TEXT för
  -- exakt rundresa.
  start_date text,
  end_date text,
  address text,
  work_location_id text,
  checklist jsonb not null default '[]'::jsonb,
  notes text not null default '',
  completed_at timestamptz,
  housing jsonb,
  tax_reduction_application jsonb,
  created_at timestamptz not null default now()
);

create index jobs_business_status_idx on public.jobs (business_id, status);
create index jobs_customer_idx on public.jobs (customer_id);

-- --------------------------------- Fakturor --------------------------------

create table public.invoices (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- NULL på utkast. Tilldelas ATOMÄRT av app.issue_invoice (06) – aldrig av
  -- klientkod, aldrig via vanlig UPDATE (trigger förbjuder).
  number integer,
  customer_id text not null references public.customers (id) on delete cascade,
  job_id text,
  quote_id text,
  type text not null check (type in ('faktura', 'delbetalning', 'slutfaktura', 'kredit')),
  status text not null check (status in ('utkast', 'skickad', 'betald', 'krediterad')),
  rot jsonb,
  tax_reduction_terms jsonb,
  tax_reduction_details jsonb,
  tax_reduction_application jsonb,
  -- Blandade strängformat i domänen (full ISO vid skapande, YYYY-MM-DD i
  -- formulär) – TEXT för exakt rundresa. ISO-strängar sorterar/filtrerar
  -- korrekt lexikografiskt per datumdel.
  issue_date text not null,
  due_date text not null,
  payment_terms_days integer not null,
  service_date date,
  late_interest_rate numeric,
  issued_at timestamptz,
  sent_at timestamptz,
  last_sent_at timestamptz,
  paid_at timestamptz,
  reminders jsonb not null default '[]'::jsonb,
  token text not null,
  ocr text not null default '',
  credits_invoice_id text,
  denied_reduction_of text,
  created_by text check (created_by in ('anvandare', 'assistent')),
  -- Denormaliserat att-betala (efter ROT/RUT). Skrivs av applikationen från
  -- domänens beräkning (docTotals) – används för listor och nyckeltal i SQL.
  amount_to_pay bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index invoices_business_number_uq on public.invoices (business_id, number)
  where number is not null;
create unique index invoices_token_uq on public.invoices (token);
create index invoices_business_status_idx on public.invoices (business_id, status);
create index invoices_business_due_open_idx on public.invoices (business_id, due_date)
  where status = 'skickad';
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_job_idx on public.invoices (business_id, job_id) where job_id is not null;

-- Fakturarader (utkast + arbetsdata). Den juridiska kopian av utfärdade rader
-- ligger i invoice_issued_snapshots. position = radordning.
create table public.invoice_line_items (
  id text not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id text not null references public.invoices (id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('arbete', 'material', 'ovrigt')),
  description text not null default '',
  qty numeric not null default 1,
  unit text not null default '',
  unit_price bigint not null default 0,
  vat_rate integer not null check (vat_rate in (0, 6, 12, 25)),
  primary key (invoice_id, id)
);

create index invoice_line_items_business_idx on public.invoice_line_items (business_id);

-- Juridisk kopia av utfärdad faktura (InvoiceIssuedSnapshot). Skrivs en gång
-- av app.issue_invoice och är därefter oföränderlig (trigger i 06).
create table public.invoice_issued_snapshots (
  invoice_id text primary key references public.invoices (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index invoice_issued_snapshots_business_idx on public.invoice_issued_snapshots (business_id);

-- -------------------------------- Betalningar ------------------------------

create table public.payments (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id text not null references public.invoices (id) on delete cascade,
  bank_transaction_id text,
  amount bigint not null,
  -- Blandade strängformat i domänen (YYYY-MM-DD eller full ISO) – TEXT för
  -- exakt rundresa.
  date text not null,
  matched_by text not null check (matched_by in ('auto', 'manuell'))
);

-- En banktransaktion kan bara matchas mot EN faktura (idempotens på DB-nivå).
create unique index payments_bank_tx_uq on public.payments (bank_transaction_id)
  where bank_transaction_id is not null;
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_business_idx on public.payments (business_id);
