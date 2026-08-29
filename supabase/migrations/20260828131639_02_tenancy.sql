-- ============================================================================
-- 02 · Tenancy: businesses, medlemskap, företagsinställningar, nummerserier
-- ----------------------------------------------------------------------------
-- users (auth.users, ägs av Supabase Auth)
--   └── business_memberships (roll: owner/admin/member)
--         └── businesses ── business_settings (1:1) ── business_sequences (1:1)
--
-- Mappning från JSON-lagret:
--   DB.settings            → business_settings (typade kolumner)
--   DB.sequences           → business_sequences (CAS-uppdateras av RPC:er)
--   DB.accounting          → businesses.accounting_locked_through
--   DB.meta                → businesses.meta (jsonb)
-- ============================================================================

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text not null default '',
  -- Optimistisk samtidighetskontroll för unit-of-work-commits:
  -- varje commit gör UPDATE ... SET state_version = state_version + 1
  -- WHERE state_version = <inläst>. 0 rader → konflikt → ladda om och kör igen.
  state_version bigint not null default 0,
  -- Bokföringen är låst t.o.m. detta datum (YYYY-MM-DD). NULL = inget lås.
  accounting_locked_through date,
  -- Engångsflaggor från JSON-lagret (seededAt m.m.). Ingen affärslogik i SQL.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.business_memberships (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_memberships_user_idx on public.business_memberships (user_id);

-- Företagsprofil – speglar CompanySettings i src/lib/types.ts.
-- logo_data_url är en övergångslösning tills logotyper flyttats till Storage
-- (bucket website-images); nya uppladdningar får en storage-sökväg i logo_path.
create table public.business_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  name text not null default '',
  company_form text not null default 'ab' check (company_form in ('ab', 'enskild')),
  org_number text not null default '',
  vat_number text not null default '',
  email text not null default '',
  inquiry_notification_email text,
  phone text not null default '',
  website_url text,
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  sate text,
  country text,
  bankgiro text not null default '',
  plusgiro text,
  bank_account text,
  iban text,
  bic text,
  logo_initials text not null default '',
  logo_data_url text,
  logo_path text,
  f_skatt_per_month bigint not null default 0,
  payroll_reserve_per_month bigint not null default 0,
  payment_terms_days integer not null default 30,
  late_interest_rate numeric not null default 10,
  quote_validity_days integer not null default 30,
  default_vat_rate integer not null default 25 check (default_vat_rate in (0, 6, 12, 25))
);

-- Nästa lediga löpnummer per serie. Uppdateras ENDAST via compare-and-swap i
-- app.*-funktionerna (06) så att två samtidiga utfärdanden aldrig kan få
-- samma nummer, oavsett applikationsbuggar.
create table public.business_sequences (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  quote integer not null default 1,
  invoice integer not null default 1,
  verification integer not null default 1
);

-- ----------------------------------------------------------------------------
-- Medlemskapskontroll som används av alla RLS-policyer.
-- SECURITY DEFINER för att undvika RLS-rekursion på business_memberships.
-- Ligger i det oexponerade app-schemat (aldrig anropbar via Data API).
-- Två vägar in:
--   * Direktanslutning (driva_app): app.business_id-GUC:en är satt.
--   * PostgREST/authenticated: auth.uid() + radens business_id.
-- ----------------------------------------------------------------------------
create or replace function app.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_business_id is not null
    and (
      p_business_id = app.current_business_id()
      or exists (
        select 1
        from public.business_memberships m
        where m.business_id = p_business_id
          and m.user_id = (select auth.uid())
      )
    )
$$;

revoke all on function app.is_member(uuid) from public;
grant execute on function app.is_member(uuid) to driva_app, authenticated;
