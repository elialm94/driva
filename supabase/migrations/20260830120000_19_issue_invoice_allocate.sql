-- ============================================================================
-- 19 · app.issue_invoice allokerar nummer + OCR när utkastet saknar dem
-- ----------------------------------------------------------------------------
-- Utkast bär medvetet number = NULL (löpnummer först vid utskick). Den
-- tidigare kroppen krävde att numret redan fanns i payloaden och kastade
-- `issue_invalid: faktura-id och nummer krävs` – hönan-och-ägget mot
-- mikrotexten. Nu allokerar funktionen själv, med radlås på
-- business_sequences, så två samtidiga utfärdanden aldrig får samma nummer.
-- ============================================================================

create or replace function app.ocr_for_invoice(p_number integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base text := p_number::text || '77';
  v_sum integer := 0;
  v_i integer;
  v_d integer;
  v_len integer := length(v_base);
begin
  if p_number is null then
    return '';
  end if;
  -- Samma Luhn som src/lib/ids.ts ocrForInvoice: bas = nummer + "77".
  for v_i in 0 .. v_len - 1 loop
    v_d := substring(v_base from v_len - v_i for 1)::integer;
    if v_i % 2 = 0 then
      v_d := v_d * 2;
      if v_d > 9 then
        v_d := v_d - 9;
      end if;
    end if;
    v_sum := v_sum + v_d;
  end loop;
  return v_base || ((10 - (v_sum % 10)) % 10)::text;
end;
$$;

revoke all on function app.ocr_for_invoice(integer) from public;
grant execute on function app.ocr_for_invoice(integer) to driva_app;

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
  v_ocr text := coalesce(p_invoice ->> 'ocr', '');
  v_snapshot jsonb := p_snapshot;
  v_line jsonb;
  v_pos integer := 0;
begin
  if v_id is null or v_id = '' then
    raise exception 'issue_invalid: faktura-id krävs' using errcode = 'P0001';
  end if;

  if v_number is null then
    -- Utkast utan löpnummer: ta nästa lediga under radlås. Två parallella
    -- anrop serialiseras här – den andra ser det uppdaterade värdet.
    update public.business_sequences
       set invoice = invoice + 1
     where business_id = p_business_id
     returning invoice - 1 into v_number;
    if v_number is null then
      raise exception 'sequence_conflict: företaget saknar sekvensrad'
        using errcode = '40001';
    end if;
  elsif p_allocate_number then
    -- Domänen har redan valt nummer (CAS mot in-memory-sekvensen). Flytta
    -- räknaren framåt och vägra dubbletter – förloraren retrys.
    if exists (
      select 1 from public.invoices i
       where i.business_id = p_business_id and i.number = v_number and i.id <> v_id
    ) then
      raise exception 'sequence_conflict: fakturanummer % är redan använt', v_number
        using errcode = '40001';
    end if;

    update public.business_sequences
       set invoice = greatest(invoice, v_number + 1)
     where business_id = p_business_id;
    if not found then
      raise exception 'sequence_conflict: företaget saknar sekvensrad'
        using errcode = '40001';
    end if;
  end if;

  if v_ocr is null or v_ocr = '' then
    v_ocr := app.ocr_for_invoice(v_number);
  end if;

  -- Snapshoten byggs i domänen; om numret allokerades här speglas det in
  -- så den juridiska kopian aldrig saknar nummer/OCR.
  if v_snapshot is not null then
    v_snapshot := jsonb_set(v_snapshot, '{number}', to_jsonb(v_number), true);
    if v_snapshot ->> 'ocr' is null or v_snapshot ->> 'ocr' = '' then
      v_snapshot := jsonb_set(v_snapshot, '{ocr}', to_jsonb(v_ocr), true);
    end if;
  end if;

  perform set_config('app.allow_issue', v_id, true);

  if exists (select 1 from public.invoices where id = v_id and business_id = p_business_id) then
    update public.invoices set
      number = v_number,
      status = coalesce(p_invoice ->> 'status', 'skickad'),
      ocr = v_ocr,
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
      v_ocr,
      p_invoice ->> 'credits_invoice_id',
      p_invoice ->> 'denied_reduction_of',
      p_invoice ->> 'created_by',
      coalesce((p_invoice ->> 'amount_to_pay')::bigint, 0),
      coalesce((p_invoice ->> 'created_at')::timestamptz, now())
    );
  end if;

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

  insert into public.invoice_issued_snapshots (invoice_id, business_id, snapshot)
  values (v_id, p_business_id, v_snapshot);

  perform set_config('app.allow_issue', '', true);

  if p_verification is not null then
    perform app.post_verification(p_business_id, p_verification);
  end if;
end;
$$;
