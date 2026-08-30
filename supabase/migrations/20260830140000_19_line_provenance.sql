-- ============================================================================
-- 19 – Radursprung och delbetalningsindex så kedjan offert → uppdrag →
-- faktura kan spåras utan att gissa. Befintliga rader lämnas tomma.
-- ============================================================================

alter table public.invoice_line_items
  add column if not exists source_kind text
    check (source_kind is null or source_kind in (
      'QUOTE_LINE', 'JOB_TIME_ENTRY', 'JOB_MATERIAL', 'JOB_OTHER', 'PAYMENT_PLAN', 'MANUAL'
    )),
  add column if not exists source_id text,
  add column if not exists source_quote_number integer,
  add column if not exists payment_plan_index integer;

alter table public.invoices
  add column if not exists payment_plan_index integer;

create index if not exists invoices_quote_plan_idx
  on public.invoices (business_id, quote_id, payment_plan_index)
  where quote_id is not null and payment_plan_index is not null;
