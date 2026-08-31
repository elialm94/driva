-- Offert/faktura.job_id får bara peka på ett uppdrag för samma kund och
-- samma företag. Kolumnerna fanns redan (quote.job_id / invoice.job_id) –
-- ingen ny relation, bara databasregel för det UI:t redan kräver.
--
-- Utfärdade fakturor: job_id är fryst EFTER att det satts. En fristående
-- utfärdad faktura får fästa en saknad koppling (NULL → värde) eftersom
-- det är metadata, inte ekonomiskt innehåll. Byte och losskoppling är
-- fortfarande förbjudna (samma immutability som tidigare).

create or replace function app.assert_document_job_same_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_customer text;
  v_job_business uuid;
begin
  if new.job_id is null then
    return new;
  end if;

  select customer_id, business_id
    into v_job_customer, v_job_business
    from public.jobs
   where id = new.job_id;

  if v_job_customer is null then
    raise exception 'document_job_link: uppdraget finns inte'
      using errcode = 'P0001';
  end if;

  if v_job_business is distinct from new.business_id then
    raise exception 'document_job_link: uppdraget tillhör ett annat företag'
      using errcode = 'P0001';
  end if;

  if v_job_customer is distinct from new.customer_id then
    raise exception 'document_job_link: dokumentet kan bara kopplas till ett uppdrag för samma kund'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists quotes_job_same_customer on public.quotes;
create trigger quotes_job_same_customer
  before insert or update of job_id, customer_id on public.quotes
  for each row execute function app.assert_document_job_same_customer();

drop trigger if exists invoices_job_same_customer on public.invoices;
create trigger invoices_job_same_customer
  before insert or update of job_id, customer_id on public.invoices
  for each row execute function app.assert_document_job_same_customer();

create or replace function app.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gate text := coalesce(current_setting('app.allow_issue', true), '');
  v_job_attach boolean;
begin
  if tg_op = 'DELETE' then
    if (old.number is not null or old.issued_at is not null)
       and not app.demo_reset_active(old.business_id) then
      raise exception 'immutability: utfärdade fakturor kan inte tas bort – kreditera i stället'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if (new.number is distinct from old.number or new.issued_at is distinct from old.issued_at)
     and v_gate <> old.id then
    raise exception 'immutability: fakturanummer tilldelas endast via app.issue_invoice'
      using errcode = 'P0001';
  end if;

  if old.issued_at is not null and v_gate <> old.id then
    -- Metadata-attach: NULL → uppdrag är tillåtet. Byte/clear är det inte.
    v_job_attach := old.job_id is null and new.job_id is not null;
    if new.customer_id is distinct from old.customer_id
       or (new.job_id is distinct from old.job_id and not v_job_attach)
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
