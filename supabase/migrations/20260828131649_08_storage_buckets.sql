-- ============================================================================
-- 08 · Storage: buckets och tenant-säkra policyer
-- ----------------------------------------------------------------------------
--   * receipts       – PRIVAT. Kvittofiler. Läses via signerade URL:er som
--                      servern skapar efter behörighetskontroll.
--   * website-images – PUBLIK (servar kundsajternas bilder och logotyper via
--                      CDN-URL). Skrivningar är tenant-skyddade.
--
-- Sökvägskonvention (första segmentet är alltid företagets uuid):
--   receipts:       <business_id>/<receipt_id>/<filnamn>
--   website-images: <business_id>/<website_id|logo>/<filnamn>
--
-- Serverns uppladdningar går via service role-nyckeln (Storage-API:t) EFTER
-- appens egna behörighetskontroller; policyerna nedan skyddar alla klient-
-- initierade vägar. Om `create policy` på storage.objects skulle nekas i en
-- hostad miljö (ägarskap ändras ibland mellan Supabase-versioner) – skapa
-- exakt dessa policyer i dashboarden i stället; se README.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('website-images', 'website-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Hjälpare: första sökvägssegmentet som uuid (eller null).
create or replace function app.storage_business_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-fA-F-]{36}/' then substring(p_name from 1 for 36)::uuid
    else null
  end
$$;

grant execute on function app.storage_business_id(text) to authenticated;

-- Kvitton: endast medlemmar i företaget, hela vägen (läsa/ladda upp/ersätta/ta bort).
create policy "receipts members select" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and app.is_member(app.storage_business_id(name)));

create policy "receipts members insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and app.is_member(app.storage_business_id(name)));

create policy "receipts members update" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and app.is_member(app.storage_business_id(name)))
  with check (bucket_id = 'receipts' and app.is_member(app.storage_business_id(name)));

create policy "receipts members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and app.is_member(app.storage_business_id(name)));

-- Hemsidebilder: publik läsning sker via bucketens publika CDN-URL.
-- Skrivningar kräver medlemskap i företaget som äger sökvägen.
create policy "website images members insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'website-images' and app.is_member(app.storage_business_id(name)));

create policy "website images members update" on storage.objects
  for update to authenticated
  using (bucket_id = 'website-images' and app.is_member(app.storage_business_id(name)))
  with check (bucket_id = 'website-images' and app.is_member(app.storage_business_id(name)));

create policy "website images members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'website-images' and app.is_member(app.storage_business_id(name)));
