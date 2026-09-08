-- Referensnummer (OCR) för inbetalningar till skattekontot (Bokföring → Moms,
-- steget Betala). Användaren hämtar numret i Skatteverkets e-tjänst
-- OCR-beräkning och sparar det här; Driva räknar det aldrig fram självt.
-- NULL = inte sparat, betalsteget länkar till e-tjänsten.
alter table public.business_settings
  add column if not exists tax_account_ocr text
    check (tax_account_ocr is null or tax_account_ocr ~ '^[0-9]{10,25}$');
