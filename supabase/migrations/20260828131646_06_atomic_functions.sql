-- ============================================================================
-- 06 · Atomära flöden (RPC) och oföränderlighet på databasnivå
-- ----------------------------------------------------------------------------
-- Affärslogiken (belopp, kontering, snapshots) beräknas i TypeScript-domänen.
-- Databasen ÄGER och verifierar invarianterna:
--
--   * Nummerserier: compare-and-swap mot business_sequences. Två samtidiga
--     utfärdanden kan aldrig få samma nummer – förloraren får ett fel och
--     hela transaktionen rullas tillbaka (appen laddar om och kör igen).
--   * Verifikationer: summa debet = summa kredit valideras i SQL innan något
--     skrivs. Bokförda rader kan aldrig ändras eller tas bort (triggers).
--   * issue_invoice: nummer + OCR + snapshot + status + bokföring – allt
--     eller inget i en funktion.
--   * match_payment: betalning + statusövergång + banktransaktion +
--     bokföring – allt eller inget; en banktransaktion kan bara matchas en
--     gång (unikt index i 03).
--
-- Funktionerna är SECURITY DEFINER i det oexponerade app-schemat och är den
-- ENDA skrivvägen till verifications/accounting_entries/invoice_issued_-
-- snapshots: driva_app har inga INSERT/UPDATE/DELETE-rättigheter på de
-- tabellerna (se 07), så inte ens applikationsbuggar kan skriva förbi dem.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Kontrollera att verifikationsrader balanserar. Kastar exception annars.
-- ----------------------------------------------------------------------------
create or replace function app.validate_entries(p_entries jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_debit bigint;
  v_credit bigint;
  v_sum_debit bigint := 0;
  v_sum_credit bigint := 0;
  v_count integer := 0;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'verifikation_ogiltig: entries saknas'
      using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_debit := coalesce((v_entry ->> 'debit')::bigint, 0);
    v_credit := coalesce((v_entry ->> 'credit')::bigint, 0);
    if v_debit < 0 or v_credit < 0 then
      raise exception 'verifikation_ogiltig: negativa belopp' using errcode = 'P0001';
    end if;
    if v_debit > 0 and v_credit > 0 then
      raise exception 'verifikation_ogiltig: debet och kredit på samma rad' using errcode = 'P0001';
    end if;
    if v_debit = 0 and v_credit = 0 then
      continue;
    end if;
    v_sum_debit := v_sum_debit + v_debit;
    v_sum_credit := v_sum_credit + v_credit;
    v_count := v_count + 1;
  end loop;
  if v_count < 2 or v_sum_debit = 0 then
    raise exception 'verifikation_ogiltig: minst två rader med belopp krävs' using errcode = 'P0001';
  end if;
  if v_sum_debit <> v_sum_credit then
    raise exception 'verifikation_obalanserad: debet % kr, kredit % kr', v_sum_debit, v_sum_credit
      using errcode = 'P0001';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bokför en verifikation. ENDA vägen in i verifications/accounting_entries.
-- p_verification: hela raden som jsonb, entries under "entries".
-- Nummer valideras med CAS mot business_sequences.verification.
-- ----------------------------------------------------------------------------
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

  -- CAS: nästa lediga nummer måste vara exakt det domänen allokerade.
  -- Radlåset på business_sequences serialiserar samtidiga bokföringar.
  update public.business_sequences
     set verification = v_number + 1
   where business_id = p_business_id
     and verification = v_number;
  if not found then
    raise exception 'sequence_conflict: verifikationsnummer % är inte nästa lediga', v_number
      using errcode = '40001';
  end if;

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
    coalesce(p_verification ->> 'source_type', 'manuell'),
    p_verification ->> 'source_id',
    coalesce(p_verification ->> 'confidence', 'hog'),
    coalesce(p_verification ->> 'created_by', 'auto'),
    'bokford',
    (p_verification ->> 'posted_at')::timestamptz,
    p_verification ->> 'fiscal_year_id',
    p_verification ->> 'corrects_verification_id',
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
end;
$$;

-- ----------------------------------------------------------------------------
-- Utfärda faktura atomärt: CAS-nummer + radlås, statusövergång, juridisk
-- snapshot, fakturarader och bokföringsverifikation – allt eller inget.
--
-- p_invoice: fakturans fullständiga rad (kolumnnamn som nycklar).
-- p_lines:   fakturarader (ersätter befintliga).
-- p_snapshot: InvoiceIssuedSnapshot (jsonb, verbatim från domänen).
-- p_verification: verifikationen som bokför utfärdandet (null för
--   migrerad/historisk data där verifikationen redan finns).
-- p_allocate_number: true när numret allokerades nu (CAS mot sekvensen);
--   false när ett äldre utkast redan bar sitt nummer.
-- ----------------------------------------------------------------------------
create or replace function app.issue_invoice(
  p_business_id uuid,
  p_invoice jsonb,
  p_lines jsonb,
  p_snapshot jsonb,
  p_verification jsonb,
  p_allocate_number boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := p_invoice ->> 'id';
  v_number integer := (p_invoice ->> 'number')::integer;
  v_line jsonb;
  v_pos integer := 0;
begin
  if v_id is null or v_number is null then
    raise exception 'issue_invalid: faktura-id och nummer krävs' using errcode = 'P0001';
  end if;

  if p_allocate_number then
    -- Dubblettvakt: numret får inte redan vara förbrukat av en annan faktura.
    -- (Unikt index (business_id, number) backar dessutom i botten.)
    if exists (
      select 1 from public.invoices i
       where i.business_id = p_business_id and i.number = v_number and i.id <> v_id
    ) then
      raise exception 'sequence_conflict: fakturanummer % är redan använt', v_number
        using errcode = '40001';
    end if;

    -- Räknaren flyttas alltid FRAMÅT (aldrig bakåt). Ett normalt flöde
    -- allokerar exakt nästa nummer; migrerad historik kan ha luckor och
    -- oordnade nummer – de släpps igenom så länge numret är ledigt.
    -- Radlåset på business_sequences serialiserar samtidiga utfärdanden,
    -- så två parallella anrop kan aldrig få samma nummer.
    update public.business_sequences
       set invoice = greatest(invoice, v_number + 1)
     where business_id = p_business_id;
    if not found then
      raise exception 'sequence_conflict: företaget saknar sekvensrad';
    end if;
  end if;

  -- Grinden som låter triggern på invoices släppa igenom nummer/utfärdande.
  perform set_config('app.allow_issue', v_id, true);

  if exists (select 1 from public.invoices where id = v_id and business_id = p_business_id) then
    -- OBS: `->` på en json-null ger jsonb 'null', inte SQL NULL – nullif()
    -- normaliserar så att kolumnjämförelser (immutability-triggern) aldrig
    -- ser en skenbar skillnad mellan jsonb-null och SQL NULL.
    update public.invoices set
      number = v_number,
      status = coalesce(p_invoice ->> 'status', 'skickad'),
      ocr = coalesce(p_invoice ->> 'ocr', ''),
      issued_at = (p_invoice ->> 'issued_at')::timestamptz,
      issue_date = p_invoice ->> 'issue_date',
      due_date = p_invoice ->> 'due_date',
      sent_at = (p_invoice ->> 'sent_at')::timestamptz,
      last_sent_at = (p_invoice ->> 'last_sent_at')::timestamptz,
      rot = nullif(p_invoice -> 'rot', 'null'::jsonb),
      tax_reduction_terms = nullif(p_invoice -> 'tax_reduction_terms', 'null'::jsonb),
      tax_reduction_details = nullif(p_invoice -> 'tax_reduction_details', 'null'::jsonb),
      service_date = (p_invoice ->> 'service_date')::date,
      amount_to_pay = coalesce((p_invoice ->> 'amount_to_pay')::bigint, 0)
    where id = v_id
      and business_id = p_business_id
      and status = 'utkast'
      and (number is null or number = v_number);
    if not found then
      raise exception 'issue_conflict: fakturan är redan utfärdad eller ändrad'
        using errcode = '40001';
    end if;
  else
    -- Kreditfakturor och migrerad data: raden skapas färdigutfärdad.
    insert into public.invoices (
      id, business_id, number, customer_id, job_id, quote_id, type, status,
      rot, tax_reduction_terms, tax_reduction_details, tax_reduction_application,
      issue_date, due_date, payment_terms_days, service_date, late_interest_rate,
      issued_at, sent_at, last_sent_at, paid_at, reminders, token, ocr,
      credits_invoice_id, denied_reduction_of, created_by, amount_to_pay, created_at
    ) values (
      v_id,
      p_business_id,
      v_number,
      p_invoice ->> 'customer_id',
      p_invoice ->> 'job_id',
      p_invoice ->> 'quote_id',
      p_invoice ->> 'type',
      coalesce(p_invoice ->> 'status', 'skickad'),
      nullif(p_invoice -> 'rot', 'null'::jsonb),
      nullif(p_invoice -> 'tax_reduction_terms', 'null'::jsonb),
      nullif(p_invoice -> 'tax_reduction_details', 'null'::jsonb),
      nullif(p_invoice -> 'tax_reduction_application', 'null'::jsonb),
      p_invoice ->> 'issue_date',
      p_invoice ->> 'due_date',
      coalesce((p_invoice ->> 'payment_terms_days')::integer, 30),
      (p_invoice ->> 'service_date')::date,
      (p_invoice ->> 'late_interest_rate')::numeric,
      (p_invoice ->> 'issued_at')::timestamptz,
      (p_invoice ->> 'sent_at')::timestamptz,
      (p_invoice ->> 'last_sent_at')::timestamptz,
      (p_invoice ->> 'paid_at')::timestamptz,
      coalesce(nullif(p_invoice -> 'reminders', 'null'::jsonb), '[]'::jsonb),
      p_invoice ->> 'token',
      coalesce(p_invoice ->> 'ocr', ''),
      p_invoice ->> 'credits_invoice_id',
      p_invoice ->> 'denied_reduction_of',
      p_invoice ->> 'created_by',
      coalesce((p_invoice ->> 'amount_to_pay')::bigint, 0),
      coalesce((p_invoice ->> 'created_at')::timestamptz, now())
    );
  end if;

  -- Fakturarader: ersätt med de frysta raderna (grinden är fortfarande öppen).
  delete from public.invoice_line_items where invoice_id = v_id and business_id = p_business_id;
  if p_lines is not null then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      insert into public.invoice_line_items (
        id, business_id, invoice_id, position, kind, description, qty, unit, unit_price, vat_rate
      ) values (
        v_line ->> 'id',
        p_business_id,
        v_id,
        v_pos,
        coalesce(v_line ->> 'kind', 'ovrigt'),
        coalesce(v_line ->> 'description', ''),
        coalesce((v_line ->> 'qty')::numeric, 1),
        coalesce(v_line ->> 'unit', ''),
        coalesce((v_line ->> 'unit_price')::bigint, 0),
        coalesce((v_line ->> 'vat_rate')::integer, 25)
      );
      v_pos := v_pos + 1;
    end loop;
  end if;

  -- Juridisk kopia. Oföränderlig via trigger.
  insert into public.invoice_issued_snapshots (invoice_id, business_id, snapshot)
  values (v_id, p_business_id, p_snapshot);

  perform set_config('app.allow_issue', '', true);

  if p_verification is not null then
    perform app.post_verification(p_business_id, p_verification);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Matcha inbetalning atomärt: betalning + statusövergång skickad→betald +
-- banktransaktion + bokföring. Idempotens: unikt index på payments.bank_-
-- transaction_id + guarded statusövergång (0 rader = redan betald → fel).
-- ----------------------------------------------------------------------------
create or replace function app.match_payment(
  p_business_id uuid,
  p_payment jsonb,
  p_bank_transaction jsonb,
  p_verification jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id text := p_payment ->> 'invoice_id';
begin
  update public.invoices
     set status = 'betald',
         paid_at = (p_payment ->> 'paid_at')::timestamptz
   where id = v_invoice_id
     and business_id = p_business_id
     and status = 'skickad'
     and type <> 'kredit';
  if not found then
    raise exception 'payment_conflict: fakturan är inte en öppen fordran'
      using errcode = '40001';
  end if;

  insert into public.payments (id, business_id, invoice_id, bank_transaction_id, amount, date, matched_by)
  values (
    p_payment ->> 'id',
    p_business_id,
    v_invoice_id,
    p_payment ->> 'bank_transaction_id',
    (p_payment ->> 'amount')::bigint,
    p_payment ->> 'date',
    coalesce(p_payment ->> 'matched_by', 'manuell')
  );

  if p_bank_transaction is not null then
    update public.bank_transactions
       set status = coalesce(p_bank_transaction ->> 'status', 'bokford'),
           matched_type = p_bank_transaction ->> 'matched_type',
           matched_id = p_bank_transaction ->> 'matched_id',
           verification_id = p_bank_transaction ->> 'verification_id'
     where id = p_bank_transaction ->> 'id'
       and business_id = p_business_id;
  end if;

  if p_verification is not null then
    perform app.post_verification(p_business_id, p_verification);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Publika token-flöden (offert-/fakturalänkar, kundsajt, BankID) behöver slå
-- upp vilket företag en token hör till INNAN tenantkontexten kan sättas.
-- Security definer-uppslag på exakt token – aldrig listning.
-- ----------------------------------------------------------------------------
create or replace function app.resolve_public_token(p_kind text, p_token text)
returns table (business_id uuid, entity_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.business_id, q.id from public.quotes q
    where p_kind = 'quote' and q.token = p_token
  union all
  select i.business_id, i.id from public.invoices i
    where p_kind = 'invoice' and i.token = p_token
  union all
  select o.business_id, o.order_ref from public.bankid_orders o
    where p_kind = 'bankid_order' and o.order_ref = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website' and w.id = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website_slug' and w.slug = p_token
  union all
  select d.business_id, d.id from public.domains d
    where p_kind = 'hostname' and lower(d.hostname) = lower(p_token)
  limit 1
$$;

-- Endast serverrollen får köra RPC:erna – aldrig anon/authenticated via Data API.
revoke all on function app.validate_entries(jsonb) from public;
revoke all on function app.post_verification(uuid, jsonb) from public;
revoke all on function app.issue_invoice(uuid, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function app.match_payment(uuid, jsonb, jsonb, jsonb) from public;
revoke all on function app.resolve_public_token(text, text) from public;
grant execute on function app.validate_entries(jsonb) to driva_app;
grant execute on function app.post_verification(uuid, jsonb) to driva_app;
grant execute on function app.issue_invoice(uuid, jsonb, jsonb, jsonb, jsonb, boolean) to driva_app;
grant execute on function app.match_payment(uuid, jsonb, jsonb, jsonb) to driva_app;
grant execute on function app.resolve_public_token(text, text) to driva_app;

-- ============================================================================
-- Oföränderlighet: triggers som gör historik omöjlig att skriva om.
-- ============================================================================

-- Verifikationer: bokförda rader ändras aldrig. Enda tillåtna ändring är att
-- corrected_by_verification_id stämplas EN gång (null → id) när en rättelse
-- bokförs – allt annat måste vara identiskt.
create or replace function app.verifications_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
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

create trigger verifications_immutable
  before update or delete on public.verifications
  for each row execute function app.verifications_immutable();

create or replace function app.rows_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutability: raderna i % är oföränderliga', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger accounting_entries_immutable
  before update or delete on public.accounting_entries
  for each row execute function app.rows_immutable();

create trigger invoice_issued_snapshots_immutable
  before update or delete on public.invoice_issued_snapshots
  for each row execute function app.rows_immutable();

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function app.rows_immutable();

-- BankID-låsta offertversioner är frysta: ingenting får ändras när locked_at
-- är satt (själva låsningen – null → tidsstämpel – är tillåten).
create or replace function app.quote_versions_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
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

create trigger quote_versions_lock
  before update or delete on public.quote_versions
  for each row execute function app.quote_versions_lock();

-- Fakturor: nummer/utfärdande sätts ENDAST via app.issue_invoice (grindas med
-- app.allow_issue). Efter utfärdande får bara statusfälten och ROT/RUT-
-- ansökningsfälten ändras – belopp, rader-referens, nummer och snapshot-
-- relaterade fält är frysta. Utfärdade fakturor kan aldrig tas bort.
create or replace function app.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gate text := coalesce(current_setting('app.allow_issue', true), '');
begin
  if tg_op = 'DELETE' then
    if old.number is not null or old.issued_at is not null then
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

create trigger invoices_guard
  before update or delete on public.invoices
  for each row execute function app.invoices_guard();

-- Fakturarader för utfärdade fakturor är frysta (utanför issue-grinden).
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

create trigger invoice_line_items_guard
  before insert or update or delete on public.invoice_line_items
  for each row execute function app.invoice_lines_guard();
