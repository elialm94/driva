-- Wave 3: rubrikrader, ROT använt i år, uppdragfoton, kvitto→material.

alter table public.invoice_line_items
  add column if not exists is_heading boolean not null default false;

alter table public.customers
  add column if not exists tax_reduction_used jsonb;

alter table public.jobs
  add column if not exists photos jsonb;

alter table public.job_work_entries
  add column if not exists expense_id text;
