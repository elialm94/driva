-- ============================================================================
-- 48 · Rabattavtal från grossist (Ahlsell avtalsfil först)
-- ----------------------------------------------------------------------------
--   * wholesaler_connections.discount_agreement: avtalets huvud (kundnummer,
--     anläggningsnummer, avtalsbeteckning, körnings-/slutdatum, kedjerabattkod,
--     antal per radtyp, täckning mot prislistan) som jsonb.
--   * wholesaler_agreement_terms: villkoren – rabatt per materialklass
--     (tiondels procent som heltal) och artikelvillkor (specrabatt eller
--     nettopris i ören). Tusentals rader per avtal → utanför aggregatet, som
--     wholesaler_products. Slås ihop med prislistan vid LÄSNING, aldrig vid
--     importen (agreement-pricing.ts).
--   * wholesaler_price_imports.format: känt grossistformat filen tolkades med.
--   * wholesaler_products.stocked: lagerförd enligt prisfilen.
--
-- Pengar är HELTALSÖREN, rabatter heltal i tiondels procent – se README,
-- ADR-1 (tillägg om grossistpriser). Avrundning till hela kronor sker först
-- när ett belopp går in i en offert-/fakturarad.
-- ============================================================================

-- Tabellerna skapas i 38. Pending-schema-tester hoppar över 38 och skapar
-- dem senare – då ska den här filen inte krascha.
do $$
begin
  if to_regclass('public.wholesaler_connections') is null then
    return;
  end if;

  alter table public.wholesaler_connections
    add column if not exists discount_agreement jsonb;

  alter table public.wholesaler_price_imports
    add column if not exists format text;

  alter table public.wholesaler_products
    add column if not exists stocked boolean;

  create table if not exists public.wholesaler_agreement_terms (
    id text primary key,
    business_id uuid not null references public.businesses (id) on delete cascade,
    connection_id text not null references public.wholesaler_connections (id) on delete cascade,
    agreement_id text not null,
    kind text not null check (kind in ('class', 'article')),
    material_class text,
    material_class_text text,
    article_number text,
    -- Normaliserad söknyckel (små bokstäver, utan skiljetecken) – samma som wholesaler_products.article_key.
    article_key text,
    discount_tenths integer check (discount_tenths is null or (discount_tenths >= 0 and discount_tenths <= 1000)),
    net_price_ore bigint check (net_price_ore is null or net_price_ore >= 0),
    chain_discount_tenths integer check (chain_discount_tenths is null or (chain_discount_tenths >= 0 and chain_discount_tenths <= 1000)),
    end_date date,
    constraint wholesaler_agreement_terms_kind_fields check (
      (kind = 'class' and material_class is not null and article_number is null)
      or (kind = 'article' and article_number is not null and material_class is null)
    )
  );

  create index if not exists wholesaler_agreement_terms_class_idx
    on public.wholesaler_agreement_terms (business_id, agreement_id, material_class) where material_class is not null;
  create index if not exists wholesaler_agreement_terms_article_idx
    on public.wholesaler_agreement_terms (business_id, agreement_id, article_key) where article_key is not null;
  create index if not exists wholesaler_agreement_terms_agreement_idx
    on public.wholesaler_agreement_terms (business_id, agreement_id);

  grant select, insert, update, delete on public.wholesaler_agreement_terms to driva_app;
  alter table public.wholesaler_agreement_terms enable row level security;
  drop policy if exists wholesaler_agreement_terms_select on public.wholesaler_agreement_terms;
  create policy wholesaler_agreement_terms_select on public.wholesaler_agreement_terms
    for select to driva_app, authenticated using (app.is_member(business_id));
  drop policy if exists wholesaler_agreement_terms_insert on public.wholesaler_agreement_terms;
  create policy wholesaler_agreement_terms_insert on public.wholesaler_agreement_terms
    for insert to driva_app, authenticated with check (app.is_member(business_id));
  drop policy if exists wholesaler_agreement_terms_update on public.wholesaler_agreement_terms;
  create policy wholesaler_agreement_terms_update on public.wholesaler_agreement_terms
    for update to driva_app, authenticated
    using (app.is_member(business_id)) with check (app.is_member(business_id));
  drop policy if exists wholesaler_agreement_terms_delete on public.wholesaler_agreement_terms;
  create policy wholesaler_agreement_terms_delete on public.wholesaler_agreement_terms
    for delete to driva_app, authenticated using (app.is_member(business_id));

  -- Same-business-invariant som för importer/produkter (funktionen från 38).
  drop trigger if exists wholesaler_agreement_terms_same_business on public.wholesaler_agreement_terms;
  create trigger wholesaler_agreement_terms_same_business
    before insert or update of connection_id, business_id on public.wholesaler_agreement_terms
    for each row execute function app.assert_wholesaler_same_business();
end $$;

-- Demoåterställningen (app.reset_demo_business) raderar wholesaler_connections;
-- villkoren följer med via ON DELETE CASCADE.
