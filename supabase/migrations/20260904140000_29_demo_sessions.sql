-- ============================================================================
-- 29 · Publika demosessioner: ETT delat lager för alla serverless-instanser
-- ----------------------------------------------------------------------------
--   * Den publika demon ("Se demo") är fortfarande INTE ett företag: inga
--     businesses-, auth.users- eller tenantrader skapas och RLS-tabellerna
--     rörs aldrig. Sessionens hela tillstånd (samma JSON-form som den lokala
--     utvecklingens .data/db.json) bor i EN rad här, nycklad med det
--     httpOnly-cookieburna session-id:t.
--   * Varför en tabell och inte en fil: Vercel kör flera instanser med var
--     sitt /tmp. Kundens "Godkänn offert" skrevs till en instans fil medan
--     Ekonomi-registret renderades av en annan – och visade en färsk klon av
--     seedet (#115 kvar som "Väntar på godkännande"). Databasen är det enda
--     lager alla instanser delar.
--   * state_version bumpas av varje skrivning (samma idé som
--     businesses.state_version): instanserna cachar tillståndet och
--     verifierar med en billig versionsfråga i stället för att läsa jsonb:n
--     varje gång.
--   * expires_at: cookiens livslängd + marginal. Utgångna rader raderas
--     opportunistiskt när nya sessioner klonas (ingen cron).
--   * Endast serverns anslutningsroll (tabellägaren via SUPABASE_DB_URL) läser
--     och skriver. RLS är på utan policyer: Data API (anon/authenticated) och
--     tenantrollen driva_app kan varken läsa eller skriva raderna.
-- ============================================================================

create table if not exists public.demo_sessions (
  id text primary key,
  state jsonb not null,
  state_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Session-id:n är [a-z0-9]{20,64} – inget annat ska kunna bli en nyckel.
alter table public.demo_sessions drop constraint if exists demo_sessions_id_format;
alter table public.demo_sessions
  add constraint demo_sessions_id_format check (id ~ '^[a-z0-9]{20,64}$');

create index if not exists demo_sessions_expires_at_idx on public.demo_sessions (expires_at);

alter table public.demo_sessions enable row level security;
revoke all on public.demo_sessions from anon, authenticated, driva_app;
