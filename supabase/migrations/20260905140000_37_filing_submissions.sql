-- ============================================================================
-- 37 · Inlämningar till myndighet
-- ----------------------------------------------------------------------------
-- En rad per inlämningsförsök av en deklaration: momsdeklarationen (eSKD),
-- arbetsgivardeklarationen (AGI), inkomstdeklarationen (INK2/SRU) och
-- årsredovisningen (iXBRL).
--
-- Statusen säger vad som HÄNT, aldrig vad Driva hoppas har hänt:
--   utkast → genererad → signerad → inlamnad → kvitterad | avvisad
-- "inlamnad" kräver ett id från myndigheten (provider_submission_id) och
-- "kvitterad" en kvittens (receipt). Se src/lib/filing/submission.ts.
--
-- files är jsonb: filnamn, innehållstyp, storlek och SHA-256 per fil. Filerna
-- SJÄLVA sparas inte – de byggs om ur bokföringen vid behov, och kontrollsumman
-- visar att det som byggs om är samma handling som signerades. INK2 har två
-- filer (BLANKETTER.SRU och INFO.SRU) i samma inlämning.
--
-- subject_id pekar in i Drivas egen data och har därför ingen FK: momsrapportens
-- periodnyckel, AGI-månaden (YYYY-MM), räkenskapsårets id, årsredovisningens id.
-- En rättelse av en redan kvitterad period blir en NY rad, så historiken visar
-- varje inlämning som gjordes.
-- ============================================================================

create table if not exists public.filing_submissions (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('moms', 'agi', 'ink2', 'arsredovisning')),
  subject_id text not null,
  label text not null,
  authority text not null check (authority in ('skatteverket', 'bolagsverket')),
  provider text not null check (provider in ('mock', 'live')),
  status text not null check (
    status in ('utkast', 'genererad', 'signerad', 'inlamnad', 'kvitterad', 'avvisad')
  ),
  files jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  signature jsonb,
  submitted_at timestamptz,
  provider_submission_id text,
  receipt jsonb,
  rejection jsonb,
  last_error text,
  created_by text not null check (created_by in ('anvandare', 'assistent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Statusens löften, i databasen och inte bara i koden.
  constraint filing_submissions_signed_has_signature check (
    status not in ('signerad', 'inlamnad', 'kvitterad') or signature is not null
  ),
  constraint filing_submissions_submitted_has_id check (
    status not in ('inlamnad', 'kvitterad') or provider_submission_id is not null
  ),
  constraint filing_submissions_receipted_has_receipt check (
    status <> 'kvitterad' or receipt is not null
  ),
  constraint filing_submissions_rejected_has_reason check (
    status <> 'avvisad' or rejection is not null
  )
);

create index if not exists filing_submissions_subject_idx
  on public.filing_submissions (business_id, kind, subject_id, created_at);

-- Myndighetens id är unikt per företag: två rader som pekar på samma inlämning
-- hos myndigheten vore två svar på samma fråga.
create unique index if not exists filing_submissions_provider_id_uq
  on public.filing_submissions (business_id, provider_submission_id)
  where provider_submission_id is not null;

grant select, insert, update, delete on public.filing_submissions to driva_app;

alter table public.filing_submissions enable row level security;
drop policy if exists filing_submissions_tenant on public.filing_submissions;
create policy filing_submissions_tenant on public.filing_submissions
  for all to driva_app, authenticated using (app.is_member(business_id)) with check (app.is_member(business_id));

comment on table public.filing_submissions is
  'Inlämningar av deklarationer till Skatteverket och Bolagsverket: statusmaskin från genererad fil via signering till kvittens.';

-- ---------------------------------------------------------------------------
-- Demoåterställningen måste tömma tabellen också.
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
  delete from public.payroll_runs where business_id = p_business_id;
  delete from public.employer_declarations where business_id = p_business_id;
  delete from public.employees where business_id = p_business_id;
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
  delete from public.year_end_schedules where business_id = p_business_id;
  delete from public.filing_submissions where business_id = p_business_id;
  delete from public.annual_reports where business_id = p_business_id;
  delete from public.chart_accounts where business_id = p_business_id;
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

  if p_keep_user_id is not null then
    update public.business_memberships
       set revoked_at = now()
     where business_id = p_business_id
       and revoked_at is null
       and user_id <> p_keep_user_id;
  end if;

  update public.business_sequences
     set quote = 1, invoice = 1, verification = 1, verification_series = '{}'::jsonb
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
