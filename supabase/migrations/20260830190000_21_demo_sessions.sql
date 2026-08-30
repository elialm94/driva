-- Isolerade publika demosessioner. Varje besökare får en egen jsonb-kopia
-- av exempeldatat. Tabellen nås bara via serverns databas-URL (RLS på,
-- inga policies för anon/authenticated).

create table if not exists public.demo_sessions (
  id text primary key,
  store jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists demo_sessions_expires_idx on public.demo_sessions (expires_at);

alter table public.demo_sessions enable row level security;

revoke all on public.demo_sessions from public, anon, authenticated;
