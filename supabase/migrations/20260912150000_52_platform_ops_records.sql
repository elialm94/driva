-- Driftposter för Ferva Admin (spec §6): senaste dokumenterade restore drill,
-- mejltest (utgående), inkommande mejl-webhook och cronkörningar. Läses och
-- skrivs enbart server-side i plattformskontext; summary är icke-känslig JSON
-- (räknare, tider, ansvarig) – aldrig mejlinnehåll, kunddata eller hemligheter.

create table public.platform_ops_records (
  id text primary key,
  kind text not null check (kind in ('restore_drill', 'email_test_outbound', 'email_inbound', 'cron_run')),
  created_at timestamptz not null default now(),
  recorded_by_user_id text,
  recorded_by_email text,
  status text not null check (status in ('ok', 'fel', 'partiell')),
  environment text,
  summary jsonb not null default '{}'::jsonb
);

create index platform_ops_records_kind_idx on public.platform_ops_records (kind, created_at desc);

alter table public.platform_ops_records enable row level security;
grant select, insert on public.platform_ops_records to driva_app;

-- Data API (authenticated/anon): inga policyer → ser ingenting.
create policy platform_ops_records_select on public.platform_ops_records
  for select to driva_app using (app.is_platform_context());
create policy platform_ops_records_insert on public.platform_ops_records
  for insert to driva_app with check (app.is_platform_context());
