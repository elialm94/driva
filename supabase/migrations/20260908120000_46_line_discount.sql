-- Radrabatt på fakturarader (procent 0–100). Offertrader ligger i
-- quote_versions.lines jsonb och tar samma fält utan schemaändring.
alter table public.invoice_line_items
  add column if not exists discount_percent numeric
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));
