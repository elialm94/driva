-- ============================================================================
-- 26 · Kvittofilen sparas – inte bara filnamnet
-- ----------------------------------------------------------------------------
-- receipts hade storage_path/content_type/size_bytes sedan 04 men inget
-- skrev till dem: "Ladda upp kvitto" registrerade filnamnet och kastade
-- filen. Bokföringslagen kräver att underlaget bevaras.
--
-- Uppladdningsflödet (src/lib/receipts/receipt-file.ts) skriver nu:
--   * storage_path        – privata bucketen `receipts` (kräver service-nyckel)
--   * content_base64      – inline-fallback (JSON-läge/demo, ≤ 1,5 MB), samma
--                           mönster som inbox_items.attachments
--   * content_type, size_bytes
-- Aldrig både storage_path och content_base64 på samma rad.
-- ============================================================================

alter table public.receipts
  add column if not exists content_base64 text;

alter table public.receipts
  drop constraint if exists receipts_one_storage_chk;
alter table public.receipts
  add constraint receipts_one_storage_chk
  check (storage_path is null or content_base64 is null);
