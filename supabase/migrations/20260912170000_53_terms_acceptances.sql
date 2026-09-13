-- Villkorsgodkännanden (spec §7): vilken villkorsversion varje användare aktivt
-- godkänt, när och i vilket sammanhang. Append-only (trigger) – ett nytt
-- godkännande är en ny rad. Läses/skrivs enbart server-side i
-- plattformskontext. Ingen IP-adress eller user agent lagras.

create table public.terms_acceptances (
  id text primary key,
  user_id uuid not null,
  business_id uuid,
  document text not null check (document in ('villkor')),
  version text not null,
  accepted_at timestamptz not null default now(),
  source text not null check (source in ('signup', 'app', 'checkout', 'admin')),
  email text
);

create index terms_acceptances_user_idx on public.terms_acceptances (user_id, accepted_at desc);
create index terms_acceptances_business_idx on public.terms_acceptances (business_id) where business_id is not null;

alter table public.terms_acceptances enable row level security;
grant select, insert on public.terms_acceptances to driva_app;

create policy terms_acceptances_select on public.terms_acceptances
  for select to driva_app using (app.is_platform_context());
create policy terms_acceptances_insert on public.terms_acceptances
  for insert to driva_app with check (app.is_platform_context());

create trigger terms_acceptances_immutable
  before update or delete on public.terms_acceptances
  for each row execute function app.rows_immutable();
