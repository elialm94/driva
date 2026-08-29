-- ============================================================================
-- 07 · Row Level Security på samtliga tenanttabeller
-- ----------------------------------------------------------------------------
-- Konsekvent mönster (dokumenterat i README):
--
--   * Varje tenanttabell har RLS PÅ och en policy som kräver
--     app.is_member(business_id):
--       - Direktanslutning (driva_app): app.business_id-GUC:en, satt av
--         servern per transaktion EFTER verifierad Supabase Auth-session.
--       - Data API (authenticated): auth.uid() ∈ business_memberships.
--       - anon: INGA policyer → ser ingenting. Publika flöden (offert-/
--         fakturatoken, kundsajt) går via servern och app.resolve_public_token.
--
--   * Historiktabeller (verifications, accounting_entries,
--     invoice_issued_snapshots) är SELECT-ONLY: inga skrivpolicyer och inga
--     skrivrättigheter för driva_app – enda skrivvägen är security definer-
--     funktionerna i 06. audit_log får INSERT men aldrig UPDATE/DELETE.
--
--   * RLS räcker inte ensamt: serverns domänguards verifierar dessutom
--     aktuellt företag på varje kritisk skrivning (IDOR-säkert även om
--     någon kopplar förbi RLS med t.ex. postgres-rollen).
-- ============================================================================

-- Grundrättigheter för serverrollen. RLS begränsar ovanpå dessa.
grant select, insert, update, delete on all tables in schema public to driva_app;

-- Historiken är skrivskyddad även på rättighetsnivå för serverrollen.
revoke insert, update, delete on public.verifications from driva_app;
revoke insert, update, delete on public.accounting_entries from driva_app;
revoke insert, update, delete on public.invoice_issued_snapshots from driva_app;
revoke update, delete on public.audit_log from driva_app;
-- Rättelser stämplar corrected_by på originalet – via trigger-vaktad UPDATE.
grant update (corrected_by_verification_id) on public.verifications to driva_app;

-- ---------------------------------------------------------------------------
-- businesses: medlemmar ser/uppdaterar sitt företag. INSERT tillåts när
-- transaktionens tenantkontext redan pekar på det nya id:t (onboarding).
-- Ingen DELETE-policy: företag tas inte bort från appen.
-- ---------------------------------------------------------------------------
alter table public.businesses enable row level security;
create policy businesses_select on public.businesses
  for select to driva_app, authenticated using (app.is_member(id));
create policy businesses_insert on public.businesses
  for insert to driva_app, authenticated with check (id = app.current_business_id());
create policy businesses_update on public.businesses
  for update to driva_app, authenticated
  using (app.is_member(id)) with check (app.is_member(id));

-- ---------------------------------------------------------------------------
-- business_memberships: användare ser sina egna medlemskap (inloggningsflödet
-- behöver dem INNAN tenantkontext finns). Skrivningar kräver medlemskap i
-- företaget – utom onboarding där kontexten redan pekar på det nya företaget.
-- ---------------------------------------------------------------------------
alter table public.business_memberships enable row level security;
create policy memberships_select on public.business_memberships
  for select to driva_app, authenticated
  using (user_id = (select auth.uid()) or app.is_member(business_id));
create policy memberships_insert on public.business_memberships
  for insert to driva_app, authenticated
  with check (app.is_member(business_id));
create policy memberships_update on public.business_memberships
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
create policy memberships_delete on public.business_memberships
  for delete to driva_app, authenticated
  using (app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- Standardmönstret för tenanttabeller.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_settings',
    'business_sequences',
    'customers',
    'work_locations',
    'requests',
    'quotes',
    'quote_versions',
    'bankid_orders',
    'signatures',
    'jobs',
    'invoices',
    'invoice_line_items',
    'payments',
    'bank_accounts',
    'bank_transactions',
    'expenses',
    'receipts',
    'supplier_invoices',
    'fiscal_years',
    'vat_reports',
    'assets',
    'accruals',
    'annual_reports',
    'websites',
    'domains',
    'assistant_messages',
    'pending_actions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id))',
      t || '_tenant', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Skrivskyddad historik: endast SELECT-policyer. Skrivningar sker uteslutande
-- via security definer-funktionerna i 06 (post_verification, issue_invoice,
-- match_payment) – de kör som funktionsägaren och påverkas inte av RLS här.
-- ---------------------------------------------------------------------------
alter table public.verifications enable row level security;
create policy verifications_select on public.verifications
  for select to driva_app, authenticated using (app.is_member(business_id));
-- Rättelsestämpeln (enda tillåtna ändringen, vaktad av trigger).
create policy verifications_correction_stamp on public.verifications
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));

alter table public.accounting_entries enable row level security;
create policy accounting_entries_select on public.accounting_entries
  for select to driva_app, authenticated using (app.is_member(business_id));

alter table public.invoice_issued_snapshots enable row level security;
create policy invoice_issued_snapshots_select on public.invoice_issued_snapshots
  for select to driva_app, authenticated using (app.is_member(business_id));

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy audit_log_insert on public.audit_log
  for insert to driva_app, authenticated with check (app.is_member(business_id));
