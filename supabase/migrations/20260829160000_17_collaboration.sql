-- ============================================================================
-- 17 – Samarbeta: redovisningskonsult / revisor mot SAMMA företag.
--
--   * Utökar business_memberships.role (per företag, inte globalt).
--   * Inbjudningar med hash:ad engångstoken.
--   * Kundunderlag (request_client_information) i tenant-tabellen.
--   * is_member ignorerar återkallade medlemskap – gamla sessioner tappar åtkomst.
--   Befintliga ägare/admin/member behåller åtkomst oförändrat.
-- ============================================================================

alter table public.business_memberships
  drop constraint if exists business_memberships_role_check;

alter table public.business_memberships
  add constraint business_memberships_role_check
  check (role in ('owner', 'admin', 'member', 'accounting_consultant', 'auditor'));

alter table public.business_memberships
  add column if not exists invited_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists last_active_at timestamptz;

create index if not exists business_memberships_active_user_idx
  on public.business_memberships (user_id)
  where revoked_at is null;

create table public.collaboration_invitations (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null,
  role text not null check (role in ('accounting_consultant', 'auditor')),
  invited_by_user_id uuid not null references auth.users (id) on delete restrict,
  invited_by_name text not null default '',
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

create unique index collaboration_invitations_token_hash_idx
  on public.collaboration_invitations (token_hash);
create index collaboration_invitations_business_idx
  on public.collaboration_invitations (business_id, created_at);
create index collaboration_invitations_email_idx
  on public.collaboration_invitations (business_id, lower(email))
  where status = 'pending';

create table public.client_information_requests (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('receipt', 'clarification', 'other')),
  title text not null default '',
  message text not null default '',
  expense_id text,
  supplier_invoice_id text,
  requested_by_user_id text not null,
  requested_by_name text not null default '',
  requested_by_role text not null check (requested_by_role in ('accounting_consultant', 'auditor')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id text
);

create index client_information_requests_business_idx
  on public.client_information_requests (business_id, created_at);
create index client_information_requests_open_idx
  on public.client_information_requests (business_id)
  where resolved_at is null;

-- Medlemskapskontroll: återkallade rader räknas inte. Befintliga rader
-- har revoked_at NULL och behåller därför åtkomst.
create or replace function app.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_business_id is not null
    and (
      p_business_id = app.current_business_id()
      or exists (
        select 1
        from public.business_memberships m
        where m.business_id = p_business_id
          and m.user_id = (select auth.uid())
          and m.revoked_at is null
      )
    )
$$;

revoke all on function app.is_member(uuid) from public;
grant execute on function app.is_member(uuid) to driva_app, authenticated;

grant select, insert, update, delete on public.collaboration_invitations to driva_app;
grant select, insert, update, delete on public.client_information_requests to driva_app;

alter table public.collaboration_invitations enable row level security;
create policy collaboration_invitations_select on public.collaboration_invitations
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy collaboration_invitations_insert on public.collaboration_invitations
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy collaboration_invitations_update on public.collaboration_invitations
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
create policy collaboration_invitations_delete on public.collaboration_invitations
  for delete to driva_app, authenticated
  using (app.is_member(business_id));

alter table public.client_information_requests enable row level security;
create policy client_information_requests_select on public.client_information_requests
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy client_information_requests_insert on public.client_information_requests
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy client_information_requests_update on public.client_information_requests
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
create policy client_information_requests_delete on public.client_information_requests
  for delete to driva_app, authenticated
  using (app.is_member(business_id));
