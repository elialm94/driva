-- ============================================================================
-- 13 – Inbox: inkommande leverantörsmejl + inbound-slug för tenantuppslag.
--
--   * Inbox är inkommande kanal (hemsideförfrågningar + leverantörsmejl),
--     inte en uppgiftslista. Förfrågningar bor kvar i public.requests.
--   * inbound_mail_slug är den stabila lokal-delen i adressen
--     (slug@INBOUND_MAIL_DOMAIN, default in.ferva.se). Tenant löses ALDRIG från From-headern.
--   * inbox_items: mjuk statusmaskin, ingen DELETE. Dedup via unique partial
--     index på external_id (samma mönster som bank_transactions i 09).
--   * Bilagor i privat bucket inbox_attachments (klon av receipts i 08).
-- ============================================================================

alter table public.business_settings
  add column if not exists inbound_mail_slug text;

-- Befintliga företag: stabil slug ur id (inte gissbar From-adress).
update public.business_settings
   set inbound_mail_slug = substring(replace(business_id::text, '-', '') from 1 for 12)
 where inbound_mail_slug is null or inbound_mail_slug = '';

alter table public.business_settings
  alter column inbound_mail_slug set default encode(gen_random_bytes(6), 'hex');

alter table public.business_settings
  alter column inbound_mail_slug set not null;

create unique index if not exists business_settings_inbound_slug_uq
  on public.business_settings (inbound_mail_slug);

create table public.inbox_items (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null default 'mail' check (kind = 'mail'),
  status text not null default 'ny' check (status in ('ny', 'behandlad', 'bokford')),
  external_id text,
  from_address text not null,
  to_address text not null,
  subject text not null default '',
  text_body text not null default '',
  html_body text,
  attachments jsonb not null default '[]'::jsonb,
  parsed_amount bigint check (parsed_amount is null or parsed_amount >= 1),
  parsed_vat_amount bigint check (parsed_vat_amount is null or parsed_vat_amount >= 0),
  parsed_supplier text,
  parsed_date date,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  expense_id text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Dedup vid import: samma leverantörs-id hos samma företag bara en gång.
create unique index if not exists inbox_items_external_uq
  on public.inbox_items (business_id, external_id)
  where external_id is not null;

create index inbox_items_business_status_idx
  on public.inbox_items (business_id, status, created_at desc);

-- Ingen DELETE – finansiell inkommande historik bevaras.
grant select, insert, update on public.inbox_items to driva_app;

alter table public.inbox_items enable row level security;
create policy inbox_items_select on public.inbox_items
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy inbox_items_insert on public.inbox_items
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy inbox_items_update on public.inbox_items
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));

-- Tenantuppslag: inbound-slug → företag. Aldrig From-header.
create or replace function app.resolve_public_token(p_kind text, p_token text)
returns table (business_id uuid, entity_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.business_id, q.id from public.quotes q
    where p_kind = 'quote' and q.token = p_token
  union all
  select i.business_id, i.id from public.invoices i
    where p_kind = 'invoice' and i.token = p_token
  union all
  select o.business_id, o.order_ref from public.bankid_orders o
    where p_kind = 'bankid_order' and o.order_ref = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website' and w.id = p_token
  union all
  select w.business_id, w.id from public.websites w
    where p_kind = 'website_slug' and w.slug = p_token
  union all
  select d.business_id, d.id from public.domains d
    where p_kind = 'hostname' and lower(d.hostname) = lower(p_token)
  union all
  select s.business_id, s.inbound_mail_slug
    from public.business_settings s
    where p_kind = 'inbound' and s.inbound_mail_slug = p_token
  limit 1
$$;

revoke all on function app.resolve_public_token(text, text) from public;
grant execute on function app.resolve_public_token(text, text) to driva_app;

-- Privat bucket för inboxbilagor (samma policy som receipts i 08).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('inbox_attachments', 'inbox_attachments', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy "inbox attachments members select" on storage.objects
  for select to authenticated
  using (bucket_id = 'inbox_attachments' and app.is_member(app.storage_business_id(name)));

create policy "inbox attachments members insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inbox_attachments' and app.is_member(app.storage_business_id(name)));

create policy "inbox attachments members update" on storage.objects
  for update to authenticated
  using (bucket_id = 'inbox_attachments' and app.is_member(app.storage_business_id(name)))
  with check (bucket_id = 'inbox_attachments' and app.is_member(app.storage_business_id(name)));

create policy "inbox attachments members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'inbox_attachments' and app.is_member(app.storage_business_id(name)));
