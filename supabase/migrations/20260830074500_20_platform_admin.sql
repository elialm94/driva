-- ============================================================================
-- 20 · Driva Admin: plattformsbehörighet, support och admin-audit
-- ----------------------------------------------------------------------------
-- Plattformsadministration är ett EGET behörighetssystem, helt skilt från
-- business_memberships (tenantroller). En platform_admins-rad ger GLOBAL
-- åtkomst till adminytan /admin – aldrig via medlemskap, aldrig via klient-
-- påståenden. Två roller:
--
--   super_admin  full plattformsåtkomst inkl. hantering av admin-teamet
--   admin        operativ drift (användare, företag, support, mätvärden)
--                men kan ALDRIG skapa/ändra/inaktivera en super_admin
--
-- Serverprocessen verifierar Supabase Auth-sessionen och slår upp raden
-- server-side före varje adminoperation (src/lib/platform/). Tabellerna här
-- har RLS PÅ utan policyer för authenticated/anon: Data API:t ser ingenting.
-- driva_app-policyerna kräver plattformskontext-GUC:en (app.platform_admin_
-- user_id) som servern sätter EFTER verifieringen – samma förtroendemodell
-- som app.business_id för tenantdata.
--
-- Bootstrap av första super_admin: scripts/platform-admin-bootstrap.ts
-- (körs manuellt med PLATFORM_SUPER_ADMIN_USER_ID – se docs/admin.md).
-- Ingen klient-sida, ingen query-param, ingen hårdkodad e-post.
-- ============================================================================

-- Delade kolumner med parallella flöden – identisk semantik, valfri ordning.
alter table public.businesses
  add column if not exists is_demo boolean not null default false;
-- Inaktiverat företag: medlemmar (utom aktiv supportsession) nekas åtkomst.
alter table public.businesses
  add column if not exists disabled_at timestamptz;

-- Adminsök på företagsnamn/orgnr (pg_trgm finns sedan migration 01).
create index if not exists businesses_name_trgm_idx
  on public.businesses using gin (name gin_trgm_ops);
create index if not exists businesses_org_number_idx
  on public.businesses (org_number);
create index if not exists businesses_created_idx
  on public.businesses (created_at desc);

-- ------------------------------ platform_admins -----------------------------

create table public.platform_admins (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin')),
  -- Denormaliserat för visning/audit – auth.users ägs av Supabase Auth.
  email text not null default '',
  name text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid,
  disabled_at timestamptz,
  disabled_by uuid
);

create unique index platform_admins_user_uq on public.platform_admins (user_id);

-- ----------------------------------------------------------------------------
-- Skydd mot ett super_admin-löst system: den sista aktiva super_admin kan
-- aldrig tas bort, inaktiveras eller nedgraderas. Överlämning kräver att en
-- annan aktiv super_admin finns FÖRST. Gäller på databasnivå – även om
-- applikationskoden skulle ha fel.
-- ----------------------------------------------------------------------------
create or replace function app.platform_admins_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_remaining integer;
  v_deactivates boolean;
begin
  -- Endast rader som just nu är aktiva super_admins vaktas.
  if old.role <> 'super_admin' or old.disabled_at is not null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Raderas, inaktiveras eller nedgraderas raden?
  if tg_op = 'DELETE' then
    v_deactivates := true;
  else
    v_deactivates := new.disabled_at is not null or new.role <> 'super_admin';
  end if;

  if v_deactivates then
    select count(*) into v_remaining
      from public.platform_admins p
     where p.id <> old.id
       and p.role = 'super_admin'
       and p.disabled_at is null;
    if v_remaining = 0 then
      raise exception 'Den sista aktiva super_admin kan inte tas bort eller inaktiveras. Utse en annan super_admin först.'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger platform_admins_guard
  before update or delete on public.platform_admins
  for each row execute function app.platform_admins_guard();

-- ------------------------- platform_admin_invitations -----------------------

-- Engångsinbjudan till rollen admin. Token hashas (SHA-256) – klartext
-- skickas bara i mejlet. super_admin skapas ALDRIG via inbjudan.
create table public.platform_admin_invitations (
  id text primary key,
  email text not null,
  role text not null default 'admin' check (role = 'admin'),
  token_hash text not null,
  invited_by_user_id uuid not null,
  invited_by_name text not null default '',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  created_at timestamptz not null default now()
);

create unique index platform_admin_invitations_token_uq
  on public.platform_admin_invitations (token_hash);
create index platform_admin_invitations_email_idx
  on public.platform_admin_invitations (lower(email));

-- ------------------------------ support_tickets -----------------------------

create table public.support_tickets (
  id text primary key,
  business_id uuid references public.businesses (id) on delete set null,
  user_id uuid,
  -- Denormaliserat: ärendet ska kunna läsas även om kontot senare tas bort.
  user_email text not null default '',
  user_name text not null default '',
  business_name text not null default '',
  subject text not null default '',
  message text not null default '',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_for_customer', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assigned_admin_id uuid,
  -- Automatiskt bifogad teknisk kontext – kunden skriver aldrig detta själv.
  route text not null default '',
  user_agent text not null default '',
  app_version text not null default '',
  -- Valfri bifogad bild/fil som data-URL (storleksbegränsad i servern).
  attachment_name text,
  attachment_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_tickets_business_idx on public.support_tickets (business_id, created_at desc);
create index support_tickets_assigned_idx on public.support_tickets (assigned_admin_id)
  where assigned_admin_id is not null;

-- ------------------------------ support_sessions ----------------------------

-- Supportläge: en admin får tidsbegränsad, motiverad och auditerad åtkomst
-- till ETT företag. Ingen imitation av kundens inloggning – admin arbetar
-- alltid som sig själv, med sessionens företag som tenantkontext.
create table public.support_sessions (
  id text primary key,
  admin_user_id uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  reason text not null,
  ticket_id text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_sessions_admin_idx on public.support_sessions (admin_user_id, started_at desc);
create index support_sessions_business_idx on public.support_sessions (business_id, started_at desc);

-- ------------------------------ admin_audit_log -----------------------------

-- Central, oföränderlig logg över alla plattformsadministrativa handlingar.
-- Ingen FK till auth.users: audit får aldrig muteras av kontoborttagning.
create table public.admin_audit_log (
  id text primary key,
  admin_user_id uuid not null,
  admin_email text not null default '',
  admin_role text not null,
  action text not null,
  target_type text,
  target_id text,
  business_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_admin_idx on public.admin_audit_log (admin_user_id, created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);

create trigger admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function app.rows_immutable();

-- -------------------------------- email_events ------------------------------

-- Operativ logg för transaktionsmejl (Resend): svarar på "varför fick kunden
-- aldrig offerten?" utan att läsa hemligheter. Skrivs av mail-lagret vid varje
-- försök. Innehåller mottagaradress (operativ nödvändighet) men aldrig
-- mejlkroppen och aldrig API-nycklar.
create table public.email_events (
  id text primary key,
  business_id uuid,
  kind text not null default '',
  document_id text,
  to_email text not null default '',
  status text not null check (status in ('sent', 'failed', 'not_configured')),
  error text,
  provider_message_id text,
  mode text not null default 'live' check (mode in ('live', 'test')),
  created_at timestamptz not null default now()
);

create index email_events_created_idx on public.email_events (created_at desc);
create index email_events_business_idx on public.email_events (business_id, created_at desc);
create index email_events_status_idx on public.email_events (status, created_at desc);

-- ----------------------------------------------------------------------------
-- Plattformskontext: servern sätter app.platform_admin_user_id per transaktion
-- EFTER att ha verifierat Supabase Auth-sessionen mot platform_admins.
-- ----------------------------------------------------------------------------
create or replace function app.current_platform_admin()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.platform_admin_user_id', true), '')::uuid
$$;

grant execute on function app.current_platform_admin() to driva_app;

create or replace function app.is_platform_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_platform_admin() is not null
$$;

grant execute on function app.is_platform_context() to driva_app;

-- Uppslag FÖRE kontexten finns (hönan-och-ägget): verifierad session-användare
-- → aktiv plattformsroll. SECURITY DEFINER så att driva_app kan anropa den
-- utan egen läsrättighet på platform_admins.
create or replace function app.platform_role_for(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.platform_admins p
   where p.user_id = p_user_id
     and p.disabled_at is null
   limit 1
$$;

revoke all on function app.platform_role_for(uuid) from public;
grant execute on function app.platform_role_for(uuid) to driva_app;

-- ----------------------------------------------------------------------------
-- RLS. Data API (authenticated/anon): INGA policyer → ser ingenting.
-- driva_app: plattformskontext krävs; support_tickets/email_events får även
-- skrivas från tenantkontext (kundens "Hjälp & support" respektive mejlloggen).
-- Historiken (admin_audit_log) är INSERT-only även för serverrollen.
-- ----------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.platform_admin_invitations enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_sessions enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.email_events enable row level security;

grant select, insert, update, delete on public.platform_admins to driva_app;
grant select, insert, update on public.platform_admin_invitations to driva_app;
grant select, insert, update on public.support_tickets to driva_app;
grant select, insert, update on public.support_sessions to driva_app;
grant select, insert on public.admin_audit_log to driva_app;
grant select, insert on public.email_events to driva_app;

create policy platform_admins_ctx on public.platform_admins
  for all to driva_app
  using (app.is_platform_context()) with check (app.is_platform_context());

create policy platform_admin_invitations_ctx on public.platform_admin_invitations
  for all to driva_app
  using (app.is_platform_context()) with check (app.is_platform_context());

create policy support_tickets_select on public.support_tickets
  for select to driva_app
  using (app.is_platform_context() or app.is_member(business_id));
create policy support_tickets_insert on public.support_tickets
  for insert to driva_app
  with check (app.is_platform_context() or app.is_member(business_id));
create policy support_tickets_update on public.support_tickets
  for update to driva_app
  using (app.is_platform_context()) with check (app.is_platform_context());

create policy support_sessions_ctx on public.support_sessions
  for all to driva_app
  using (app.is_platform_context()) with check (app.is_platform_context());

create policy admin_audit_log_select on public.admin_audit_log
  for select to driva_app using (app.is_platform_context());
create policy admin_audit_log_insert on public.admin_audit_log
  for insert to driva_app with check (app.is_platform_context());

create policy email_events_select on public.email_events
  for select to driva_app using (app.is_platform_context());
create policy email_events_insert on public.email_events
  for insert to driva_app
  with check (
    app.is_platform_context()
    or business_id is null
    or business_id = app.current_business_id()
  );
