-- Leveranshistorik per kanal (e-post / SMS) för offerter och fakturor.
-- Kompletterar last_email; fejkar aldrig "levererat" utan provider-callback.

alter table public.quotes
  add column if not exists deliveries jsonb;

alter table public.invoices
  add column if not exists deliveries jsonb;
