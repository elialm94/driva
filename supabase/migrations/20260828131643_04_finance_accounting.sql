-- ============================================================================
-- 04 · Ekonomi och bokföring: bank, utgifter, kvitton, leverantörsfakturor,
--      verifikationer, räkenskapsår, moms, inventarier, periodiseringar,
--      årsredovisningar
-- ----------------------------------------------------------------------------
--   * verifications + accounting_entries är dubbel bokföring: balansen
--     (summa debet = summa kredit) valideras på serversidan i
--     app.post_verification (06). Bokförda rader är oföränderliga – rättelser
--     görs ENDAST som ny rättelseverifikation.
--   * Datumfält som i domänen är blandade strängformat (ISO eller YYYY-MM-DD)
--     lagras som TEXT för exakt rundresa; kanoniska tidsstämplar är timestamptz.
-- ============================================================================

-- ----------------------------------- Bank ----------------------------------

create table public.bank_accounts (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('mock', 'tink')),
  name text not null default '',
  account_number text not null default '',
  balance bigint not null default 0,
  connected_at timestamptz not null default now()
);

create index bank_accounts_business_idx on public.bank_accounts (business_id);

create table public.bank_transactions (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_id text not null references public.bank_accounts (id) on delete cascade,
  -- Domänen lagrar blandade strängformat – TEXT för exakt rundresa
  -- (ISO-strängar sorterar korrekt lexikografiskt).
  date text not null,
  -- Positivt = inbetalning, negativt = utbetalning. Hela kronor.
  amount bigint not null,
  counterpart text not null default '',
  description text not null default '',
  reference text,
  status text not null check (status in ('ny', 'matchad', 'bokford', 'behover_atgard')),
  matched_type text check (matched_type in ('faktura', 'utgift', 'leverantorsfaktura', 'skatt', 'ovrigt')),
  matched_id text,
  verification_id text
);

create index bank_transactions_business_status_idx on public.bank_transactions (business_id, status);
create index bank_transactions_account_idx on public.bank_transactions (account_id);

-- --------------------------------- Utgifter --------------------------------

create table public.expenses (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier text not null default '',
  date text not null,
  -- Totalbelopp inkl. moms, hela kronor.
  amount bigint not null default 0,
  vat_amount bigint not null default 0,
  category text,
  description text,
  job_id text,
  receipt_id text,
  bank_transaction_id text,
  status text not null check (status in ('saknar_kvitto', 'behover_svar', 'bokford')),
  question jsonb,
  verification_id text,
  created_at timestamptz not null default now()
);

create index expenses_business_status_idx on public.expenses (business_id, status);

-- Kvitton. Filen ligger i den privata bucketen `receipts` under
-- <business_id>/<receipt_id>/<filnamn>; metadata om filen ligger här.
-- Äldre demo-kvitton saknar fil (storage_path null) – bara metadata + mock-OCR.
create table public.receipts (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  expense_id text,
  filename text not null default '',
  source text not null check (source in ('foto', 'uppladdning', 'email')),
  uploaded_at timestamptz not null default now(),
  extracted jsonb not null,
  storage_path text,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid
);

create index receipts_business_idx on public.receipts (business_id);
create index receipts_expense_idx on public.receipts (expense_id) where expense_id is not null;

-- --------------------------- Leverantörsfakturor ---------------------------

create table public.supplier_invoices (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier text not null default '',
  invoice_number text not null default '',
  date text not null,
  due_date text not null,
  amount bigint not null default 0,
  vat_amount bigint not null default 0,
  description text not null default '',
  category text not null default '',
  status text not null check (status in ('obetald', 'betald')),
  bank_transaction_id text,
  verification_id text,
  payment_verification_id text,
  created_at timestamptz not null default now()
);

create index supplier_invoices_business_status_idx on public.supplier_invoices (business_id, status);

-- ------------------------------ Räkenskapsår -------------------------------

create table public.fiscal_years (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('oppet', 'stangt')),
  -- Ingående balanser per konto: {"1930": 125000, ...}. Summan är alltid 0.
  opening_balances jsonb not null default '{}'::jsonb,
  opening_source text not null check (opening_source in ('migrering', 'foregaende_ar', 'manuell')),
  closed_at timestamptz,
  closing_verification_ids jsonb
);

create unique index fiscal_years_business_label_uq on public.fiscal_years (business_id, label);
create index fiscal_years_business_start_idx on public.fiscal_years (business_id, start_date);

-- ------------------------------ Verifikationer -----------------------------

-- Bokförd affärshändelse. Oföränderlig efter bokföring: trigger (06) tillåter
-- endast att corrected_by_verification_id stämplas EN gång (null → id) –
-- allt annat är förbjudet. Nya rader skapas ENDAST via app.post_verification.
create table public.verifications (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  series text not null default 'A',
  number integer not null,
  -- Bokföringsdatum (styr period, momsperiod och räkenskapsår). Domänen
  -- blandar YYYY-MM-DD och fulla ISO-strängar – TEXT för exakt rundresa
  -- (ISO-strängar sorterar korrekt lexikografiskt per datumdel).
  date text not null,
  description text not null,
  source_type text not null,
  source_id text,
  confidence text not null check (confidence in ('hog', 'medel', 'lag')),
  created_by text not null check (created_by in ('auto', 'anvandare', 'assistent')),
  status text not null default 'bokford' check (status = 'bokford'),
  posted_at timestamptz not null,
  fiscal_year_id text,
  corrects_verification_id text,
  corrected_by_verification_id text,
  explanation text,
  created_at timestamptz not null default now()
);

create unique index verifications_business_series_number_uq
  on public.verifications (business_id, series, number);
create index verifications_business_date_idx on public.verifications (business_id, date);
create index verifications_fiscal_year_idx on public.verifications (business_id, fiscal_year_id);

create table public.accounting_entries (
  verification_id text not null references public.verifications (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete cascade,
  position integer not null,
  account integer not null,
  account_name text not null,
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  vat_code text,
  note text,
  primary key (verification_id, position),
  check (debit = 0 or credit = 0)
);

create index accounting_entries_business_account_idx on public.accounting_entries (business_id, account);

-- ---------------------------------- Moms -----------------------------------

create table public.vat_reports (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  fiscal_year_id text not null,
  period_start date not null,
  period_end date not null,
  label text not null,
  status text not null check (status in ('utkast', 'deklarerad')),
  boxes jsonb not null default '[]'::jsonb,
  utgaende bigint not null default 0,
  ingaende bigint not null default 0,
  att_betala bigint not null default 0,
  generated_at timestamptz not null,
  declared_at timestamptz,
  settle_verification_id text
);

create index vat_reports_business_idx on public.vat_reports (business_id, fiscal_year_id);

-- ------------------------------- Inventarier -------------------------------

create table public.assets (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  acquisition_date date not null,
  acquisition_value bigint not null,
  asset_account integer not null,
  depreciation_account integer not null,
  accumulated_depreciation_account integer not null,
  useful_life_years integer not null,
  status text not null check (status in ('aktiv', 'fullt_avskriven', 'utrangerad')),
  source_expense_id text,
  acquisition_verification_id text,
  depreciations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index assets_business_idx on public.assets (business_id);

-- ----------------------------- Periodiseringar -----------------------------

create table public.accruals (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('forutbetald_kostnad', 'upplupen_kostnad', 'forutbetald_intakt', 'upplupen_intakt')),
  description text not null default '',
  amount bigint not null,
  counter_account integer not null,
  balance_account integer not null,
  from_date date not null,
  to_date date not null,
  fiscal_year_id text not null,
  status text not null check (status in ('planerad', 'bokford', 'aterford')),
  source_type text check (source_type in ('utgift', 'leverantorsfaktura', 'kundfaktura')),
  source_id text,
  book_verification_id text,
  reverse_verification_id text,
  created_at timestamptz not null default now()
);

create index accruals_business_idx on public.accruals (business_id, fiscal_year_id);

-- ----------------------------- Årsredovisningar ----------------------------

create table public.annual_reports (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  fiscal_year_id text not null,
  status text not null check (status in ('genererad', 'granskad', 'signerad', 'inlamnad_markerad')),
  content jsonb not null,
  generated_at timestamptz not null,
  reviewed_at timestamptz,
  signed_at timestamptz,
  marked_filed_at timestamptz
);

create index annual_reports_business_idx on public.annual_reports (business_id, fiscal_year_id);
