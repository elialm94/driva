-- ============================================================================
-- 31 · Manuella verifikat: serier, handelsdatum och bilaga på verifikationen
-- ----------------------------------------------------------------------------
-- Tre luckor i datamodellen stängs:
--
--   1. Verifikationsserier. Serien fanns som kolumn men allt bokfördes i "A"
--      med en enda räknare. Varje serie måste ha en egen obruten nummerföljd –
--      annars lämnar serierna hål i varandras numrering. Räknarna ligger i
--      business_sequences.verification_series (serie → nästa nummer). Serie A
--      speglas i den ursprungliga kolumnen, så ingen backfill behövs.
--
--   2. Handelsdatum vid sidan av bokföringsdatum. Bokföringsdatumet styr
--      period, moms och räkenskapsår; handelsdatumet är en uppgift om när
--      händelsen inträffade och styr ingenting.
--
--   3. Bilaga direkt på verifikationen, så en granskare kan öppna underlaget
--      från raden. Samma lagringsmönster som kvitton: bucket när fillagring
--      finns, annars inline.
--
-- Kolumnerna sätts vid insert i app.post_verification. Verifikationer är
-- oföränderliga (trigger i migration 06), så de kan aldrig ändras efteråt.
-- ============================================================================

alter table public.business_sequences
  add column if not exists verification_series jsonb not null default '{}'::jsonb;

alter table public.verifications
  add column if not exists transaction_date date,
  add column if not exists attachment_filename text,
  add column if not exists attachment_content_type text,
  add column if not exists attachment_size_bytes bigint,
  add column if not exists attachment_storage_path text,
  add column if not exists attachment_content_base64 text;

-- ---------------------------------------------------------------------------
-- app.post_verification: CAS mot seriens egen räknare, plus de nya fälten.
-- Full kropp från 06 – bara nummertilldelningen och insert:en ändras.
-- ---------------------------------------------------------------------------
create or replace function app.post_verification(p_business_id uuid, p_verification jsonb)
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
  perform app.validate_entries(p_verification -> 'entries');

  -- CAS: nästa lediga nummer i SERIEN måste vara exakt det domänen allokerade.
  -- Radlåset på business_sequences serialiserar samtidiga bokföringar.
  -- Serie A läser den ursprungliga kolumnen när serieräknaren saknas, så
  -- bokföring som gjordes innan serier fanns fortsätter på sitt nummer.
  update public.business_sequences
     set verification_series = jsonb_set(
           coalesce(verification_series, '{}'::jsonb),
           array[v_series],
           to_jsonb(v_number + 1)
         ),
         verification = case when v_series = 'A' then v_number + 1 else verification end
   where business_id = p_business_id
     and coalesce(
           (verification_series ->> v_series)::integer,
           case when v_series = 'A' then verification else 1 end
         ) = v_number;
  if not found then
    raise exception 'sequence_conflict: verifikationsnummer % i serie % är inte nästa lediga', v_number, v_series
      using errcode = '40001';
  end if;

  insert into public.verifications (
    id, business_id, series, number, date, transaction_date, description,
    source_type, source_id, confidence, created_by, status, posted_at,
    fiscal_year_id, corrects_verification_id, explanation, created_at,
    attachment_filename, attachment_content_type, attachment_size_bytes,
    attachment_storage_path, attachment_content_base64
  ) values (
    p_verification ->> 'id',
    p_business_id,
    v_series,
    v_number,
    p_verification ->> 'date',
    (p_verification ->> 'transaction_date')::date,
    coalesce(p_verification ->> 'description', ''),
    coalesce(p_verification ->> 'source_type', 'manuell'),
    p_verification ->> 'source_id',
    coalesce(p_verification ->> 'confidence', 'hog'),
    coalesce(p_verification ->> 'created_by', 'auto'),
    'bokford',
    (p_verification ->> 'posted_at')::timestamptz,
    p_verification ->> 'fiscal_year_id',
    p_verification ->> 'corrects_verification_id',
    p_verification ->> 'explanation',
    coalesce((p_verification ->> 'created_at')::timestamptz, now()),
    p_verification ->> 'attachment_filename',
    p_verification ->> 'attachment_content_type',
    (p_verification ->> 'attachment_size_bytes')::bigint,
    p_verification ->> 'attachment_storage_path',
    p_verification ->> 'attachment_content_base64'
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
end;
$$;

revoke all on function app.post_verification(uuid, jsonb) from public;
grant execute on function app.post_verification(uuid, jsonb) to driva_app;

-- ---------------------------------------------------------------------------
-- Demoåterställningen nollar serieräknarna med samma UPDATE som förut.
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
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
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
