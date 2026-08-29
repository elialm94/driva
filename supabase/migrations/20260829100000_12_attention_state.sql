-- ============================================================================
-- 12 – Uppmärksamhetstillstånd: snooze/avfärdan för åtgärdsmotorns rader.
--
--   * action_id är åtgärdsmotorns STABILA rad-id (t.ex. "invoice-late-<id>").
--     Raden är ren presentationspolicy: domänstatus ändras ALDRIG här – en
--     snoozad faktura är fortfarande försenad, den döljs bara ur "Behöver
--     din uppmärksamhet" (och ur räknaren) tills snoozed_until passerats.
--     Därefter syns den automatiskt igen OM motorn fortfarande härleder den.
--   * user_id är den som snoozade (auth.users.id). Med inloggning är
--     tillståndet per användare; i JSON-/demoläget utan inloggning är
--     user_id null → företagsgemensamt. Unikheten är null-säker (coalesce)
--     så upsert per (företag, åtgärd, användare) fungerar i båda världarna.
--   * dismissed_at/dismissal_reason: endast för typer med dismissBehavior
--     HIDE (rent ignorerbara info-rader). Domänavfärdanden ("Markera
--     hanterad" på förfrågan, "Inte aktuell" på offert) lagras ALDRIG här –
--     de är riktiga statusövergångar på entiteten.
--   * Ingen DELETE-väg för serverrollen – rader uppdateras på plats (upsert),
--     samma mjuka filosofi som reminders (10).
-- ============================================================================

create table public.attention_states (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id),
  action_id text not null check (length(action_id) between 1 and 200),
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  dismissal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- En rad per (företag, åtgärd, användare). Null-användaren (JSON-läget utan
-- inloggning) får en egen null-säker plats i unikheten via coalesce.
create unique index attention_states_scope_uq
  on public.attention_states (
    business_id,
    action_id,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index attention_states_business_user_idx
  on public.attention_states (business_id, user_id, snoozed_until);

-- Serverrollen: ingen DELETE – tillstånd skrivs om, aldrig bort.
grant select, insert, update on public.attention_states to driva_app;

-- RLS enligt standardmönstret (07): medlemskap i företaget krävs.
alter table public.attention_states enable row level security;
create policy attention_states_select on public.attention_states
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy attention_states_insert on public.attention_states
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy attention_states_update on public.attention_states
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
