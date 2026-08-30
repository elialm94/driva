-- ============================================================================
-- 18 – Betalningsuppgifternas tillståndsmodell för leverantörsfakturor.
--
--   * supplier_invoices.payment_details (jsonb): lagrat tillstånd + proveniens
--     { state: VERIFIED | EXTRACTION_UNCERTAIN | MISSING | AWAITING_SUPPLIER,
--       verified?: { method, account, ocr?, source, verifiedAt, verifiedBy },
--       candidate?: { account?, ocr? },        -- osäker läsning, ALDRIG betalbar
--       request?: { to, sentAt } }             -- förfrågan skickad till leverantören
--     CHANGED härleds vid läsning (dokument ≠ tidigare verifierat) och lagras inte.
--   * inbox_items.parsed_details_confidence: tolkens konfidens specifikt för
--     betalningsuppgifterna (bankgiro/OCR) – styr proveniensen document vs
--     document_uncertain vid mottagning.
-- ============================================================================

alter table public.supplier_invoices
  add column if not exists payment_details jsonb;

alter table public.inbox_items
  add column if not exists parsed_details_confidence numeric;
