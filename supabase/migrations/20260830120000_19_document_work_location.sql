-- Bostad på offert och faktura för ROT/RUT-utskick.
-- Samma relation som jobs.work_location_id (kundens work_locations).
-- JSON-lagret speglar fältet som workLocationId på Quote/Invoice.

alter table public.quotes
  add column if not exists work_location_id text;

alter table public.invoices
  add column if not exists work_location_id text;
