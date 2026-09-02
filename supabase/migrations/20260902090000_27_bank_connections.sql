-- ============================================================================
-- 27 · Bankkoppling (Open Banking AIS via Tink)
-- ----------------------------------------------------------------------------
--   * bank_connections: EN rad per företag med kopplingens status, Tink-id:n
--     (permanent user = företaget, credentials = bankmedgivandet) och en
--     cachad användartoken. Tokens är hemligheter: tabellen har RLS med policy
--     ENDAST för serverrollen driva_app – aldrig för authenticated (Data API).
--     UI:t läser en projektion utan hemligheter (src/lib/banking/connection-state.ts).
--   * bank_accounts.external_id: leverantörens konto-id så att återimport av
--     konton blir idempotent (samma Tink-konto → samma rad).
--   * Koppla från återkallar Tink-åtkomsten men raderar INTE bank_transactions
--     eller verifikationer – historiken ägs av bokföringen, inte av kopplingen.
--   * reset_demo_business tömmer även bank_connections (full kropp från 23).
-- ============================================================================

alter table public.bank_accounts add column if not exists external_id text;
create unique index if not exists bank_accounts_external_id_uq
  on public.bank_accounts (business_id, external_id)
  where external_id is not null;

create table if not exists public.bank_connections (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('mock', 'tink')),
  status text not null check (status in ('disconnected', 'pending', 'connected', 'error', 'revoked')),
  external_user_id text,
  tink_user_id text,
  credentials_id text,
  -- Server-only hemligheter. Nås aldrig av klient eller Data API.
  access_token text,
  access_token_expires_at timestamptz,
  pending_state text,
  pending_state_expires_at timestamptz,
  bank_name text,
  masked_account text,
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- En koppling per företag.
create unique index if not exists bank_connections_business_uq on public.bank_connections (business_id);

grant select, insert, update, delete on public.bank_connections to driva_app;

alter table public.bank_connections enable row level security;
drop policy if exists bank_connections_server on public.bank_connections;
-- Endast serverrollen (tenantkontext via app.business_id-GUC:en). Ingen
-- policy för authenticated: tokens ska aldrig kunna läsas via Data API.
create policy bank_connections_server on public.bank_connections
  for all to driva_app using (app.is_member(business_id)) with check (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- reset_demo_business: full kropp från 23 + bank_connections.
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
