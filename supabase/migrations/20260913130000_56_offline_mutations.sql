-- Offline-fältläge V1 (spec §9): serverns kvitton på synkade mutationer.
--
-- Klienten är aldrig sanningskälla. Varje offline-mutation bär en
-- klientgenererad idempotensnyckel; servern validerar auth, tenant, capability
-- och version som vanligt, tillämpar mutationen via de vanliga tjänsterna och
-- skriver EN rad här. Ett andra försök med samma nyckel (dubbelsynk, två
-- enheter, appdöd mitt i synk) får det första utfallet tillbaka utan att något
-- görs om. Ingen payload lagras – bara typ, utfall och referens.

create table public.offline_mutations (
  id text primary key,
  business_id uuid not null,
  user_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  kind text not null check (char_length(kind) between 1 and 64),
  client_created_at timestamptz not null,
  applied_at timestamptz not null default now(),
  outcome text not null check (outcome in ('synced', 'conflict', 'failed', 'rejected')),
  result_ref text,
  message text,
  unique (business_id, idempotency_key)
);

create index offline_mutations_business_idx on public.offline_mutations (business_id, applied_at desc);

alter table public.offline_mutations enable row level security;
grant select, insert on public.offline_mutations to driva_app;

create policy offline_mutations_select on public.offline_mutations
  for select to driva_app using (app.is_platform_context());
create policy offline_mutations_insert on public.offline_mutations
  for insert to driva_app with check (app.is_platform_context());

create trigger offline_mutations_immutable
  before update or delete on public.offline_mutations
  for each row execute function app.rows_immutable();
