-- ============================================================================
-- 42 · Materialbutiken: bild, varumärke, kategorinyckel och favoriter
-- ----------------------------------------------------------------------------
--   * wholesaler_products.brand / image_url: läses ur grossistens prisfil
--     (ingen ny integration – bara fler kolumner som mappas vid importen).
--   * wholesaler_products.category_key: normaliserad kategori (små bokstäver,
--     utan skiljetecken) så att butiken kan bläddra per kategori med index.
--   * wholesaler_connections.favorite_articles: favoritartiklar nycklade på
--     artikelnummer (artikel-id byts vid varje import, artikelnumret består).
-- ============================================================================

alter table public.wholesaler_products
  add column if not exists brand text,
  add column if not exists image_url text,
  add column if not exists category_key text;

-- Befintliga rader: samma normalisering som appen (lower + icke-bokstäver → blanksteg).
update public.wholesaler_products
   set category_key = nullif(
         trim(regexp_replace(lower(category), '[^[:alnum:]]+', ' ', 'g')),
         ''
       )
 where category is not null and category_key is null;

create index if not exists wholesaler_products_import_category_idx
  on public.wholesaler_products (business_id, import_id, category_key) where category_key is not null;

alter table public.wholesaler_connections
  add column if not exists favorite_articles jsonb;
