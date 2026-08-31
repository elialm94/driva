-- ============================================================================
-- 22 · Standardvillkor för nya offerter
-- ----------------------------------------------------------------------------
--   * default_quote_terms: företagets egna villkor som kopieras till nya
--     offerter (quote.terms). Tomt/NULL = fallback till STANDARD_TERMS i
--     appen. Befintliga offerter ändras inte när inställningen ändras.
--   * ROT/RUT-villkor lagras separat på quote_versions.tax_reduction_terms
--     och hör inte hemma i det här fältet.
-- ============================================================================

alter table public.business_settings
  add column if not exists default_quote_terms text;

update public.business_settings
  set default_quote_terms = 'Offerten omfattar arbete och material enligt specifikationen ovan. Eventuella tillkommande arbeten offereras separat innan de påbörjas. Vi innehar F-skattsedel och full ansvarsförsäkring. Garanti lämnas enligt konsumenttjänstlagen.'
  where default_quote_terms is null;
