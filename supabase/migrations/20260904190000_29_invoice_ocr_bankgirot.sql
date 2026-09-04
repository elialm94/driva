-- ============================================================================
-- 29 · Kundfaktura-OCR enligt Bankgirot OCR-10 (mjuk / utan längdsiffra)
-- ----------------------------------------------------------------------------
-- Tidigare app.ocr_for_invoice lade till suffixet "77" före Luhn-siffran.
-- Det är varken mjuk OCR-10 (nummer + kontroll) eller hård OCR-10
-- (nummer + längdsiffra + kontroll). Betalstacken dokumenterar inte hård OCR,
-- så vi följer mjuk OCR-10 i src/lib/ids.ts ocrForInvoice.
--
-- Utfärdade fakturor med redan sparat OCR skrivs inte om här – SQL fyller
-- bara tomma värden vid issue (samma som tidigare). Unikt index vaktar att
-- två utfärdade fakturor i samma företag inte delar OCR.
-- ============================================================================

create or replace function app.ocr_for_invoice(p_number integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base text := p_number::text;
  v_sum integer := 0;
  v_i integer;
  v_d integer;
  v_len integer;
begin
  if p_number is null then
    return '';
  end if;
  -- Bankgirot OCR-10 soft = src/lib/ids.ts ocrForInvoice:
  -- bas = fakturanumrets siffror, vikter 2-1-2… från höger, produkt >9 → −9.
  v_len := length(v_base);
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

create unique index if not exists invoices_business_ocr_uq
  on public.invoices (business_id, ocr)
  where ocr <> '';
