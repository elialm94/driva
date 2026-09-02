-- ============================================================================
-- 25 · Index för tenantladdning: bankid_orders och signatures
-- ----------------------------------------------------------------------------
-- Varje request laddar hela tenanten med `select * … where business_id = $1`
-- (src/lib/storage/load.ts). bankid_orders och signatures var de enda
-- tenanttabellerna utan index på business_id, så de lästes med seq scan över
-- alla företag. Ordningen matchar load.ts ORDER BY så sorteringen kan komma
-- direkt ur indexet.
-- ============================================================================

create index if not exists bankid_orders_business_created_idx
  on public.bankid_orders (business_id, created_at, order_ref);

create index if not exists signatures_business_signed_idx
  on public.signatures (business_id, signed_at, id);
