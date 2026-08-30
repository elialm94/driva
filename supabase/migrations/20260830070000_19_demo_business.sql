-- ============================================================================
-- 19 · Demoföretag: publikt demoläge på riktig auth utan att försvaga
--      oföränderligheten för riktiga företag.
--
--   * businesses.is_demo markerar ETT dedikerat demoföretag. Flaggan sätts
--     endast vid INSERT (seed-skriptet) och fryses av en trigger – ett
--     riktigt företag kan aldrig i efterhand "bli demo" och därmed aldrig
--     nås av återställningsvägen nedan.
--   * app.reset_demo_business(uuid) tömmer demoföretagets data atomärt så
--     att exempeldatat kan spelas upp igen (samma importväg som db:seed).
--     Immutabilitetstriggrarna öppnas ENDAST för DELETE, ENDAST i samma
--     transaktion som satt app.demo_reset-GUC:en (jfr app.allow_issue-
--     grinden i 06), och ENDAST för rader vars företag är is_demo. För alla
--     andra företag är garantierna exakt oförändrade.
-- ============================================================================

alter table public.businesses
  add column if not exists is_demo boolean not null default false;

-- is_demo bestäms när företaget skapas och kan aldrig ändras därefter.
create or replace function app.businesses_demo_flag_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_demo is distinct from old.is_demo then
    raise exception 'immutability: is_demo kan inte ändras efter att företaget skapats'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_demo_flag_frozen on public.businesses;
create trigger businesses_demo_flag_frozen
  before update on public.businesses
  for each row execute function app.businesses_demo_flag_frozen();

-- ----------------------------------------------------------------------------
-- Grinden: sann ENDAST när transaktionen uttryckligen begärt demo-återställning
-- (GUC:en sätts bara av app.reset_demo_business) OCH raden hör till ett
-- företag som skapades som demo. SECURITY DEFINER så uppslaget inte påverkas
-- av RLS-kontexten hos den roll som råkar utföra raderingen.
-- ----------------------------------------------------------------------------
create or replace function app.demo_reset_active(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('app.demo_reset', true), '') = '1'
     and exists (
       select 1 from public.businesses b
        where b.id = p_business_id and b.is_demo
     );
$$;

revoke all on function app.demo_reset_active(uuid) from public;
grant execute on function app.demo_reset_active(uuid) to driva_app;

-- ----------------------------------------------------------------------------
-- Immutabilitetstriggrarna får ett demo-undantag för DELETE. Kropparna är i
-- övrigt identiska med senaste versionerna (06 resp. 11) – UPDATE-skyddet
-- gäller oförändrat även under en demo-återställning.
-- ----------------------------------------------------------------------------

create or replace function app.verifications_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if app.demo_reset_active(old.business_id) then
      return old;
    end if;
    raise exception 'immutability: bokförda verifikationer kan inte tas bort. Rättelser bokförs som ny verifikation.'
      using errcode = 'P0001';
  end if;
  if to_jsonb(old) - 'corrected_by_verification_id' <> to_jsonb(new) - 'corrected_by_verification_id'
     or (old.corrected_by_verification_id is not null
         and new.corrected_by_verification_id is distinct from old.corrected_by_verification_id) then
    raise exception 'immutability: bokförda verifikationer kan inte ändras. Rättelser bokförs som ny verifikation.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function app.rows_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.demo_reset_active(old.business_id) then
    return old;
  end if;
  raise exception 'immutability: raderna i % är oföränderliga', tg_table_name
    using errcode = 'P0001';
end;
$$;

create or replace function app.quote_versions_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null
       and not app.demo_reset_active(old.business_id) then
      raise exception 'immutability: BankID-låsta offertversioner kan inte tas bort'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.locked_at is not null then
    raise exception 'immutability: offertversion % är låst av BankID-signering och kan inte ändras', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Full kropp från 11 (inkl. rich_text) med demo-undantag i DELETE-grenen.
create or replace function app.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gate text := coalesce(current_setting('app.allow_issue', true), '');
begin
  if tg_op = 'DELETE' then
    if (old.number is not null or old.issued_at is not null)
       and not app.demo_reset_active(old.business_id) then
      raise exception 'immutability: utfärdade fakturor kan inte tas bort – kreditera i stället'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Nummer/utfärdandestämpel får bara röras genom issue-grinden.
  if (new.number is distinct from old.number or new.issued_at is distinct from old.issued_at)
     and v_gate <> old.id then
    raise exception 'immutability: fakturanummer tilldelas endast via app.issue_invoice'
      using errcode = 'P0001';
  end if;

  -- Efter utfärdande: frys allt utom statusflöde och ROT/RUT-uppföljning.
  if old.issued_at is not null and v_gate <> old.id then
    if new.customer_id is distinct from old.customer_id
       or new.job_id is distinct from old.job_id
       or new.quote_id is distinct from old.quote_id
       or new.type is distinct from old.type
       or new.rot is distinct from old.rot
       or new.rich_text is distinct from old.rich_text
       or new.tax_reduction_terms is distinct from old.tax_reduction_terms
       or new.issue_date is distinct from old.issue_date
       or new.due_date is distinct from old.due_date
       or new.payment_terms_days is distinct from old.payment_terms_days
       or new.service_date is distinct from old.service_date
       or new.late_interest_rate is distinct from old.late_interest_rate
       or new.token is distinct from old.token
       or new.ocr is distinct from old.ocr
       or new.credits_invoice_id is distinct from old.credits_invoice_id
       or new.denied_reduction_of is distinct from old.denied_reduction_of
       or new.amount_to_pay is distinct from old.amount_to_pay
       or new.created_at is distinct from old.created_at then
      raise exception 'immutability: utfärdade fakturor ändras inte – korrigera med kreditfaktura'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app.invoice_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gate text := coalesce(current_setting('app.allow_issue', true), '');
  v_invoice_id text;
  v_issued timestamptz;
begin
  if tg_op = 'DELETE' and app.demo_reset_active(old.business_id) then
    return old;
  end if;
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  if v_gate = v_invoice_id then
    return coalesce(new, old);
  end if;
  select issued_at into v_issued from public.invoices where id = v_invoice_id;
  if v_issued is not null then
    raise exception 'immutability: rader på utfärdade fakturor kan inte ändras'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- Återställningen: tömmer ETT demoföretags data atomärt. Företagsraden och
-- demo-användarens medlemskap behålls (exempeldatat spelas upp igen genom
-- appens importväg efteråt). Vägrar för alla icke-demo-företag.
-- p_keep_user_id: demo-användaren – alla ANDRA medlemskap återkallas så att
-- en accepterad demo-inbjudan aldrig överlever en återställning.
-- ----------------------------------------------------------------------------
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
  delete from public.requests where business_id = p_business_id;
  delete from public.job_work_entries where business_id = p_business_id;
  delete from public.jobs where business_id = p_business_id;
  delete from public.work_locations where business_id = p_business_id;
  delete from public.customers where business_id = p_business_id;
  delete from public.bank_transactions where business_id = p_business_id;
  delete from public.bank_accounts where business_id = p_business_id;
  delete from public.receipts where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.supplier_payments where business_id = p_business_id;
  delete from public.supplier_invoices where business_id = p_business_id;
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
