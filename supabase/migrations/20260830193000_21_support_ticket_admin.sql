-- ============================================================================
-- 21 · Supportärenden: adminhantering, privat bilaga, intern anteckning
-- ----------------------------------------------------------------------------
-- Kundens "Hjälp & support" skapar en rad i support_tickets. Det är källan
-- till sanning – inte mejl. Kolumnerna här gör det möjligt att stänga
-- ärendet, anteckna internt och peka på en privat Storage-fil i stället för
-- att lagra data-URL:er i databasen.
-- ============================================================================

alter table public.support_tickets
  add column if not exists resolved_at timestamptz;
alter table public.support_tickets
  add column if not exists resolved_by uuid;
alter table public.support_tickets
  add column if not exists admin_notes text not null default '';
alter table public.support_tickets
  add column if not exists attachment_path text;
alter table public.support_tickets
  add column if not exists environment text not null default '';

-- Privat bucket: endast servern (service role) efter admin-/ägarkontroll.
-- Inga policyer för authenticated/anon → Data API:t ser ingenting.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support_attachments',
  'support_attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
