-- ============================================================================
-- 11 – "Övrig information": rik text på offerter och fakturor.
--
--   * Formatet är en strikt vitlistad delmängd av TipTap/ProseMirror-JSON
--     (aldrig HTML) – saneras i applikationens servergräns (lib/richtext).
--   * quote_versions behöver INGEN ändring: payload (jsonb) bär hela
--     QuoteVersion verbatim, inklusive det nya fältet. BankID-låset (06)
--     fryser därmed även den rika texten.
--   * invoices får en rich_text-kolumn (explicit kolumnmodell). Fältet fryses
--     efter utfärdande precis som övriga dokumentfält – utfärdade fakturor
--     renderar den juridiska kopian i invoice_issued_snapshots.
--   * RLS är tabellnivå (07) – en ny kolumn behöver ingen ny policy, och
--     grants på invoices är också tabellnivå.
-- ============================================================================

alter table public.invoices add column rich_text jsonb;

-- ----------------------------------------------------------------------------
-- Fakturavakten uppdateras: rich_text ingår i den frysta ytan efter
-- utfärdande (samma policy som rot/villkor – ändringar görs med kreditfaktura).
-- Full funktionskropp från 06 med rich_text-raden tillagd.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- app.issue_invoice uppdateras: rich_text följer med i både uppdaterings-
-- vägen (utkastraden ägs av grinden, samma behandling som rot) och insert-
-- vägen (kreditfakturor och migrerad data skapas färdigutfärdade – utan
-- kolumnen skulle importerade fakturor tappa fältet). Full kropp från 06.
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
      rich_text = nullif(p_invoice -> 'rich_text', 'null'::jsonb),
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
      rot, rich_text, tax_reduction_terms, tax_reduction_details, tax_reduction_application,
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
      nullif(p_invoice -> 'rich_text', 'null'::jsonb),
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
