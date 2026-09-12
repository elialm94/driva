-- Förslagskvalitet för bankklassificeringen (spec §3): varje visat förslag och
-- användarens slutval loggas aggregerbart – utan motpartstext, belopp,
-- dokumentinnehåll eller personnummer. Läses av Ferva Admin (plattformskontext),
-- skrivs från tenantkontext (samma mönster som email_events).

create table public.suggestion_events (
  id text primary key,
  business_id uuid,
  created_at timestamptz not null default now(),
  direction text not null check (direction in ('in', 'ut')),
  source text not null default '',
  tier text not null check (tier in ('saker', 'troligt', 'osakert')),
  decision text not null check (decision in ('auto', 'accepted', 'changed', 'rejected', 'private')),
  human_required text[] not null default '{}',
  merchant_type text,
  kb_version text not null default '',
  rule_version integer,
  provider text,
  model text,
  prompt_version text,
  input_hash text not null default '',
  suggested text,
  final_choice text not null default '',
  amount_bucket text not null check (amount_bucket in ('under_500', '500_5000', 'over_5000'))
);

create index suggestion_events_created_idx on public.suggestion_events (created_at desc);
create index suggestion_events_source_idx on public.suggestion_events (source, decision, created_at desc);
create index suggestion_events_business_idx on public.suggestion_events (business_id, created_at desc);

alter table public.suggestion_events enable row level security;
grant select, insert on public.suggestion_events to driva_app;

-- Data API (authenticated/anon): inga policyer → ser ingenting.
create policy suggestion_events_select on public.suggestion_events
  for select to driva_app using (app.is_platform_context());
create policy suggestion_events_insert on public.suggestion_events
  for insert to driva_app
  with check (
    app.is_platform_context()
    or business_id is null
    or business_id = app.current_business_id()
  );
