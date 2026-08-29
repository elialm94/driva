-- ============================================================================
-- 05 · Hemsida, domäner, assistent och central audit-logg
-- ----------------------------------------------------------------------------
--   * websites: en per företag i V1 (unique business_id). Sektionsbilder är
--     i övergångsfasen data-URL:er i sections-jsonb; nya uppladdningar läggs i
--     Storage-bucketen website-images och refereras med sökväg/URL.
--   * audit_log ersätter fyra tidigare loggar (activity, bokföringens
--     auditTrail, domainAudit, assistantAudit) med EN oföränderlig tabell.
--     channel avgör vilken domänvy raden mappas tillbaka till.
--     metadata får ALDRIG innehålla personnummer eller andra känsliga fält.
-- ============================================================================

-- --------------------------------- Hemsida ---------------------------------

create table public.websites (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  slug text not null,
  business_name text not null default '',
  tagline text not null default '',
  city text,
  status text not null check (status in ('utkast', 'publicerad')),
  theme text not null check (theme in ('tra', 'studio', 'ren', 'el', 'konsult')),
  -- Sektioner i visningsordning. Bildfält: data-URL (övergång) eller
  -- storage-sökväg/URL. Innehållet ägs av domänlagret.
  sections jsonb not null default '[]'::jsonb,
  primary_cta jsonb,
  published_at timestamptz,
  submissions integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index websites_business_uq on public.websites (business_id);
create unique index websites_slug_uq on public.websites (slug);

-- --------------------------------- Domäner ---------------------------------

create table public.domains (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  website_id text,
  hostname text not null,
  tld text not null default 'se',
  source text not null check (source in ('purchased', 'existing')),
  registrar_provider text not null,
  registrar_domain_id text,
  registrar_registrant_id text,
  status text not null,
  is_primary boolean not null default false,
  registered_at timestamptz,
  expires_at timestamptz,
  auto_renew boolean not null default true,
  verification_status text not null default 'pending',
  ssl_status text not null default 'pending',
  billing jsonb not null,
  provisioning jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ett hostname kan bara finnas hos EN tenant – blockerar cross-tenant takeover.
create unique index domains_hostname_uq on public.domains (lower(hostname));
create unique index domains_idempotency_uq on public.domains (business_id, idempotency_key);
create index domains_business_idx on public.domains (business_id);

-- -------------------------------- Assistent --------------------------------

create table public.assistant_messages (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  at timestamptz not null,
  text text not null default '',
  card jsonb
);

create index assistant_messages_business_at_idx on public.assistant_messages (business_id, at);

-- Väntande åtgärder som kräver bekräftelse. Hela unionen som payload –
-- innehållet ägs av assistentlagret och är kortlivat.
create table public.pending_actions (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index pending_actions_business_idx on public.pending_actions (business_id);

-- -------------------------------- Audit-logg -------------------------------

-- EN central, oföränderlig händelselogg för hela tenanten.
--   channel = 'activity'   → UI-flödet (tidigare DB.activity)
--   channel = 'accounting' → bokföringens audit trail (tidigare DB.auditTrail)
--   channel = 'domain'     → domänhändelser (tidigare DB.domainAudit)
--   channel = 'assistant'  → assistentens verktygslogg (tidigare DB.assistantAudit)
-- actor_user_id sätts av servern från inloggad session; actor_label behåller
-- domänens etikett (anvandare/assistent/system).
-- metadata är icke-känslig JSON (aldrig personnummer, aldrig tokens).
create table public.audit_log (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel text not null check (channel in ('activity', 'accounting', 'domain', 'assistant')),
  actor_user_id uuid,
  actor_label text not null default 'system' check (actor_label in ('anvandare', 'assistent', 'system')),
  event_type text not null,
  entity_type text,
  entity_id text,
  customer_id text,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index audit_log_business_created_idx on public.audit_log (business_id, created_at desc);
create index audit_log_business_channel_idx on public.audit_log (business_id, channel, created_at desc);
create index audit_log_customer_idx on public.audit_log (business_id, customer_id)
  where customer_id is not null;
