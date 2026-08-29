-- ============================================================================
-- 09 – Financial autopilot: delbetalningar, betalningsmatchning, dedup.
--
--   * Fakturor: status 'delbetald' (utfärdad fordran, delvis betald),
--     refund (återbetalning till kund efter kreditering/överbetalning) och
--     overpayment_credit (överbetalning bokförd som skuld på 2420).
--   * Banktransaktioner: external_id (leverantörens transaktions-id) med unikt
--     index – en import kan aldrig skapa dubbletter. Status 'matchad' utgår
--     (förslag härleds vid läsning och lagras aldrig); matched_type får
--     'skattereduktion' (SKV-utbetalning av ROT/RUT) och 'aterbetalning'.
--   * Betalningar: beloppet måste vara positivt (hela kronor ≥ 1).
--   * Kvitton: ETT kvitto per utgift (unikt index) – dubbeluppladdning kan
--     aldrig koppla två kvitton till samma köp.
--   * app.match_payment v2: bokför det FAKTISKA bankbeloppet, målstatus
--     kommer från domänen ('betald'/'delbetald') och övergången vaktas
--     (skickad/delbetald → betald/delbetald, aldrig från betald/krediterad).
-- ============================================================================

-- ------------------------------- Fakturor ----------------------------------

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('utkast', 'skickad', 'delbetald', 'betald', 'krediterad'));

alter table public.invoices add column if not exists refund jsonb;
alter table public.invoices add column if not exists overpayment_credit bigint
  check (overpayment_credit is null or overpayment_credit > 0);

-- Öppna fordringar inkluderar delbetalda.
drop index if exists public.invoices_business_due_open_idx;
create index invoices_business_due_open_idx on public.invoices (business_id, due_date)
  where status in ('skickad', 'delbetald');

-- --------------------------- Banktransaktioner -----------------------------

alter table public.bank_transactions add column if not exists external_id text;

-- Dedup vid import: samma leverantörs-id på samma konto kan bara finnas en gång.
create unique index if not exists bank_transactions_external_uq
  on public.bank_transactions (business_id, account_id, external_id)
  where external_id is not null;

-- 'matchad' lagrades aldrig av domänen – städa ev. rader innan checken byts.
update public.bank_transactions set status = 'behover_atgard' where status = 'matchad';
alter table public.bank_transactions drop constraint if exists bank_transactions_status_check;
alter table public.bank_transactions add constraint bank_transactions_status_check
  check (status in ('ny', 'bokford', 'behover_atgard'));

alter table public.bank_transactions drop constraint if exists bank_transactions_matched_type_check;
alter table public.bank_transactions add constraint bank_transactions_matched_type_check
  check (matched_type in ('faktura', 'utgift', 'leverantorsfaktura', 'skatt', 'skattereduktion', 'aterbetalning', 'ovrigt'));

-- ------------------------------ Betalningar --------------------------------

alter table public.payments drop constraint if exists payments_amount_positive;
alter table public.payments add constraint payments_amount_positive check (amount >= 1);

-- -------------------------------- Kvitton ----------------------------------

-- Ett kvitto per utgift. (Det gamla icke-unika indexet ersätts.)
drop index if exists public.receipts_expense_idx;
create unique index if not exists receipts_expense_uq
  on public.receipts (expense_id)
  where expense_id is not null;

-- --------------------------- app.match_payment v2 --------------------------
-- Bokför det FAKTISKA bankbeloppet. Målstatus ('betald'/'delbetald') beräknas
-- av domänen (öres-tolerans, delbetalning, överbetalning som 2420-skuld) och
-- valideras här: bara öppna fordringar kan ta emot betalningar, beloppet är
-- positivt, en banktransaktion kan aldrig användas två gånger (unikt index).

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
  v_status text := coalesce(p_payment ->> 'status', 'betald');
  v_amount bigint := (p_payment ->> 'amount')::bigint;
begin
  if v_status not in ('betald', 'delbetald') then
    raise exception 'payment_conflict: ogiltig målstatus efter betalning: %', v_status
      using errcode = '40001';
  end if;
  if v_amount is null or v_amount < 1 then
    raise exception 'payment_conflict: betalningsbeloppet måste vara minst 1 kr'
      using errcode = '40001';
  end if;

  update public.invoices
     set status = v_status,
         paid_at = case when v_status = 'betald'
                        then (p_payment ->> 'paid_at')::timestamptz
                        else paid_at end,
         overpayment_credit = case when p_payment ? 'overpayment_credit'
                                   then nullif((p_payment ->> 'overpayment_credit')::bigint, 0)
                                   else overpayment_credit end
   where id = v_invoice_id
     and business_id = p_business_id
     and status in ('skickad', 'delbetald')
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
    v_amount,
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

revoke all on function app.match_payment(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function app.match_payment(uuid, jsonb, jsonb, jsonb) to driva_app;
